import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  checkImagePixelBudget,
  MAX_IMAGE_EDGE,
  readImageDimensions,
} from '../../apps/api/src/domain/media/ImageHeaderDimensions';
import { describeUploadRejection, MediaLibraryUseCase, MediaStoragePort } from '../../apps/api/src/application/use-cases/media/MediaLibraryUseCase';

/**
 * Decompression-bomb guard: dimensions are read from the header of REAL encoder
 * output (sharp), in every accepted format, and a tiny file declaring a huge
 * canvas is refused before anything decodes it.
 */

const sharp = createRequire(`${process.cwd()}/apps/api/package.json`)('sharp') as typeof import('sharp');

async function encode(width: number, height: number, format: 'png' | 'jpeg' | 'webp' | 'avif' | 'gif', opts: Record<string, unknown> = {}) {
  const img = sharp({ create: { width, height, channels: 3, background: '#93D500' } });
  return (img as any)[format](opts).toBuffer() as Promise<Buffer>;
}

/** A valid PNG header claiming width × height, with a minimal IDAT: a few hundred bytes. */
function pngClaiming(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(64))), chunk('IEND', Buffer.alloc(0))]);
}

describe('readImageDimensions — real encoder output', () => {
  const cases: Array<[string, 'png' | 'jpeg' | 'webp' | 'avif' | 'gif', string, Record<string, unknown>?]> = [
    ['PNG', 'png', 'image/png'],
    ['baseline JPEG', 'jpeg', 'image/jpeg'],
    ['progressive JPEG', 'jpeg', 'image/jpeg', { progressive: true }],
    ['lossy WebP (VP8)', 'webp', 'image/webp'],
    ['lossless WebP (VP8L)', 'webp', 'image/webp', { lossless: true }],
    ['AVIF', 'avif', 'image/avif'],
    ['GIF', 'gif', 'image/gif'],
  ];
  for (const [label, format, mime, opts] of cases) {
    it(`reads ${label}`, async () => {
      const buf = await encode(1234, 567, format, opts);
      expect(readImageDimensions(buf, mime)).toEqual({ width: 1234, height: 567 });
    });
  }

  it('reads an extended WebP (VP8X, with alpha)', async () => {
    const buf = await sharp({ create: { width: 801, height: 403, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).webp().toBuffer();
    expect(buf.toString('ascii', 12, 16)).toBe('VP8X');
    expect(readImageDimensions(buf, 'image/webp')).toEqual({ width: 801, height: 403 });
  });

  it('reads a JPEG carrying EXIF before the frame header', async () => {
    const buf = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#fff' } }).withMetadata({ exif: { IFD0: { Copyright: 'GoldPlus' } } }).jpeg().toBuffer();
    expect(readImageDimensions(buf, 'image/jpeg')).toEqual({ width: 640, height: 480 });
  });

  it('returns null for truncated or foreign bytes instead of guessing', () => {
    expect(readImageDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')).toBeNull();
    expect(readImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0]), 'image/jpeg')).toBeNull();
    expect(readImageDimensions(Buffer.alloc(40), 'image/webp')).toBeNull();
    expect(readImageDimensions(Buffer.alloc(40), 'application/pdf')).toBeNull();
  });
});

describe('checkImagePixelBudget', () => {
  it('passes a normal product photograph', async () => {
    expect(checkImagePixelBudget(await encode(4000, 3000, 'jpeg'), 'image/jpeg')).toMatchObject({ ok: true, dimensions: { width: 4000, height: 3000 } });
  });

  it('refuses a few-hundred-byte PNG that declares 60,000 × 60,000 pixels', () => {
    const bomb = pngClaiming(60_000, 60_000);
    expect(bomb.length).toBeLessThan(1024);
    expect(checkImagePixelBudget(bomb, 'image/png')).toMatchObject({ ok: false, reason: 'TOO_MANY_PIXELS' });
  });

  it('refuses an absurd strip that is under the pixel cap but over the edge cap', () => {
    expect(checkImagePixelBudget(pngClaiming(MAX_IMAGE_EDGE + 1, 10), 'image/png')).toMatchObject({ ok: false });
  });

  it('refuses an unreadable PNG/JPEG/GIF/WebP header (an unknown size cannot be proven safe); AVIF is left to the decoder cap', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(checkImagePixelBudget(Buffer.alloc(40), mime)).toEqual({ ok: false, dimensions: null, reason: 'UNREADABLE' });
    }
    expect(checkImagePixelBudget(Buffer.alloc(40), 'image/avif')).toEqual({ ok: true, dimensions: null });
  });

  it('sees through junk bytes before a JPEG marker, as libjpeg does (a 60,000 x 60,000 frame cannot hide behind them)', async () => {
    const jpg = await encode(64, 48, 'jpeg');
    let i = 2; while (!(jpg[i] === 0xff && jpg[i + 1] >= 0xc0 && jpg[i + 1] <= 0xc2)) i++;
    jpg.writeUInt16BE(60000, i + 5); jpg.writeUInt16BE(60000, i + 7);
    const cut = 4 + jpg.readUInt16BE(4);
    const crafted = Buffer.concat([jpg.subarray(0, cut), Buffer.from([0x00, 0x12, 0x34]), jpg.subarray(cut)]);
    // The decoder really does read it that big…
    expect((await sharp(crafted, { limitInputPixels: false }).metadata()).width).toBe(60000);
    // …so the header check must too.
    expect(readImageDimensions(crafted, 'image/jpeg')).toEqual({ width: 60000, height: 60000 });
    expect(checkImagePixelBudget(crafted, 'image/jpeg')).toMatchObject({ ok: false, reason: 'TOO_MANY_PIXELS' });
  });
});

describe('MediaLibraryUseCase refuses the bomb before storing or decoding it', () => {
  it('rejects with TOO_MANY_PIXELS and touches neither storage nor the variant generator', async () => {
    const writes: string[] = [];
    let decoded = 0;
    const storage: MediaStoragePort = {
      async saveAsset(dir, name) { writes.push(`${dir}/${name}`); return { url: '', storageKey: '', physicalPath: '' }; },
      async deleteByKey() {},
    };
    const repo = { findByChecksum: async () => null } as any;
    const useCase = new MediaLibraryUseCase(repo, storage, { generate: async () => { decoded++; return { width: null, height: null, variants: [] }; } }, { assignAsCover: async () => ({ ok: true as const }) });
    const [outcome] = await useCase.upload({ files: [{ filename: 'bomb.png', mime: 'image/png', buffer: pngClaiming(60_000, 60_000) }], actorId: null });
    expect(outcome).toEqual({ kind: 'REJECTED', filename: 'bomb.png', reason: 'TOO_MANY_PIXELS' });
    expect(writes).toEqual([]);
    expect(decoded).toBe(0);
    expect(describeUploadRejection('TOO_MANY_PIXELS')).toMatch(/50 megapixels/);
  });
});
