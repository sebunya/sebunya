import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SharpVariantGenerator } from '../../apps/api/src/infrastructure/media/SharpVariantGenerator';
import { MediaLibraryUseCase } from '../../apps/api/src/application/use-cases/media/MediaLibraryUseCase';

/**
 * Two media-library guarantees the home-page portraits depend on (and every
 * product photo benefits from):
 *  - a phone photo shot upright is stored upright: renditions honour the EXIF
 *    Orientation tag, and the recorded size is the upright size;
 *  - a photo still used on the site cannot be archived (archiving never took it
 *    off the site, so it only hid a live photo from the library).
 */
const sharp = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('sharp');

describe('renditions honour EXIF orientation', () => {
  it('a portrait stored as landscape pixels + Orientation 6 comes out portrait', async () => {
    // 400×300 pixels tagged "rotate 90°": a camera's way of storing a 300×400 portrait.
    const buffer = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#93D500' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const saved: Array<{ key: string; buffer: Buffer }> = [];
    const out = await new SharpVariantGenerator().generate({
      buffer, mime: 'image/jpeg', checksum: 'x',
      saveVariant: async (key, b) => { saved.push({ key, buffer: b }); return { url: `/u/${key}`, storageKey: key }; },
    });
    expect({ width: out.width, height: out.height }).toEqual({ width: 300, height: 400 });
    const thumb = out.variants.find((v) => v.purpose === 'thumb' && v.format === 'webp')!;
    expect(thumb.height).toBeGreaterThan(thumb.width!);
    expect(out.variants.some((v) => v.purpose === 'card')).toBe(false); // 480 > the upright 300 px width: never upscaled
    const meta = await sharp(saved.find((s) => s.key === 'thumb.webp')!.buffer).metadata();
    expect(meta.height).toBeGreaterThan(meta.width);
  });
});

describe('archiving a photo in use', () => {
  const useCase = (usages: unknown[]) => {
    const repo = { usages: vi.fn(async () => usages), setStatus: vi.fn(async () => ({ id: 'a', status: 'ARCHIVED' })) };
    return { repo, uc: new MediaLibraryUseCase(repo as any, {} as any, {} as any, {} as any) };
  };
  it('is refused while any page uses it — like delete', async () => {
    const { repo, uc } = useCase([{ entity: 'homepage_ambassador' }, { entity: 'product' }]);
    expect(await uc.archive('a')).toEqual({ kind: 'IN_USE', usages: 2 });
    expect(repo.setStatus).not.toHaveBeenCalled();
  });
  it('goes ahead when nothing uses it', async () => {
    const { repo, uc } = useCase([]);
    expect(await uc.archive('a')).toMatchObject({ status: 'ARCHIVED' });
    expect(repo.setStatus).toHaveBeenCalledWith('a', 'ARCHIVED');
  });
});
