import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { SharpVariantGenerator } from '../../apps/api/src/infrastructure/media/SharpVariantGenerator';
import {
  carriesMetadata,
  listImageFiles,
  mimeForFile,
  planStrip,
  stripStoredImages,
  uprightSize,
} from '../../apps/api/src/scripts/stripStoredImageMetadata';

/**
 * #22: originals stored before uploads were cleaned may still carry a phone's
 * GPS fix. The ops script rewrites only those, with the upload path's own strip,
 * keeps the upright pixels, and is dry-run unless told to apply.
 */
const sharp = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('sharp');
const generator = new SharpVariantGenerator();
const deps = {
  strip: (b: Buffer, m: string) => generator.stripMetadata(b, m),
  readMeta: async (b: Buffer) => sharp(b).metadata(),
};

/** 400×300 landscape pixels + Orientation 6 (a 300×400 portrait) with a GPS fix and a camera serial. */
const phoneShot = (format: 'jpeg' | 'webp' | 'png' = 'jpeg'): Promise<Buffer> =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: '#93D500' } })
    [format]()
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'PhoneCo', Model: 'X1', Copyright: 'serial-123' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '0/1 20/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '32/1 35/1 0/1' },
    })
    .toBuffer();

const cleanShot = (): Promise<Buffer> => sharp({ create: { width: 64, height: 48, channels: 3, background: '#000' } }).jpeg().toBuffer();

describe('detection', () => {
  it('knows the upload types and nothing else', () => {
    expect(mimeForFile('a/b/original.JPG')).toBe('image/jpeg');
    expect(mimeForFile('x.jpeg')).toBe('image/jpeg');
    expect(mimeForFile('x.png')).toBe('image/png');
    expect(mimeForFile('x.webp')).toBe('image/webp');
    expect(mimeForFile('x.gif')).toBeNull();
    expect(mimeForFile('x.avif')).toBeNull();
  });
  it('treats EXIF/XMP/IPTC or a non-upright orientation as metadata to strip', () => {
    expect(carriesMetadata({})).toBe(false);
    expect(carriesMetadata({ orientation: 1 })).toBe(false);
    expect(carriesMetadata({ orientation: 6 })).toBe(true);
    expect(carriesMetadata({ exif: Buffer.from('x') })).toBe(true);
    expect(carriesMetadata({ xmp: Buffer.from('x') })).toBe(true);
  });
  it('swaps width and height for 90-degree orientations', () => {
    expect(uprightSize({ width: 400, height: 300, orientation: 6 })).toEqual({ width: 300, height: 400 });
    expect(uprightSize({ width: 400, height: 300, orientation: 3 })).toEqual({ width: 400, height: 300 });
  });
});

describe('planStrip', () => {
  it('removes EXIF and GPS and keeps the photo upright at its seen size', async () => {
    const input = await phoneShot();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.exif!.includes(Buffer.from('PhoneCo'))).toBe(true);
    const out = await planStrip(input, 'image/jpeg', deps);
    expect(out.action).toBe('stripped');
    if (out.action !== 'stripped') return;
    const after = await sharp(out.buffer).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect({ width: after.width, height: after.height }).toEqual({ width: 300, height: 400 });
    expect(out.buffer.includes(Buffer.from('PhoneCo'))).toBe(false);
    expect(out.buffer.includes(Buffer.from('serial-123'))).toBe(false);
  });

  it('also strips WebP and PNG originals', async () => {
    for (const [format, mime] of [['webp', 'image/webp'], ['png', 'image/png']] as const) {
      const out = await planStrip(await phoneShot(format), mime, deps);
      expect(out.action).toBe('stripped');
    }
  });

  it('leaves a clean file alone (a second run is a no-op)', async () => {
    const strip = vi.fn(deps.strip);
    expect((await planStrip(await cleanShot(), 'image/jpeg', { ...deps, strip })).action).toBe('clean');
    expect(strip).not.toHaveBeenCalled();
  });

  it('refuses a result that still has metadata or changed size, and a file it cannot read', async () => {
    const input = await phoneShot();
    expect(await planStrip(input, 'image/jpeg', { ...deps, strip: async (b) => b })).toMatchObject({ action: 'failed', reason: expect.stringContaining('still present') });
    const tiny = await cleanShot();
    expect(await planStrip(input, 'image/jpeg', { ...deps, strip: async () => tiny })).toMatchObject({ action: 'failed', reason: expect.stringContaining('size changed') });
    expect(await planStrip(input, 'image/jpeg', { ...deps, strip: async () => null })).toMatchObject({ action: 'failed' });
    expect(await planStrip(Buffer.from('not an image'), 'image/jpeg', deps)).toMatchObject({ action: 'failed', reason: expect.stringContaining('unreadable') });
  });
});

describe('stripStoredImages over a media root', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'strip-meta-'));
    await mkdir(path.join(root, 'uploads/assets/ab/abcdef'), { recursive: true });
    await writeFile(path.join(root, 'uploads/assets/ab/abcdef/original.jpg'), await phoneShot());
    await writeFile(path.join(root, 'uploads/assets/ab/abcdef/thumb.jpg'), await cleanShot());
    await writeFile(path.join(root, 'uploads/assets/ab/abcdef/anim.gif'), Buffer.from('GIF89a'));
    await writeFile(path.join(root, '.hidden.jpg'), await phoneShot());
    await symlink(path.join(root, 'uploads/assets/ab/abcdef/original.jpg'), path.join(root, 'link.jpg'));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('lists regular image files only (no dotfiles, symlinks or GIFs)', async () => {
    const files = (await listImageFiles(root)).map((f) => path.relative(root, f));
    expect(files).toEqual(['uploads/assets/ab/abcdef/original.jpg', 'uploads/assets/ab/abcdef/thumb.jpg']);
  });

  it('is a dry run by default: reports, writes nothing', async () => {
    const original = path.join(root, 'uploads/assets/ab/abcdef/original.jpg');
    const bytes = await readFile(original);
    const lines: string[] = [];
    const report = await stripStoredImages({ root, apply: false, ...deps, log: (l) => lines.push(l) });
    expect(report).toMatchObject({ scanned: 2, clean: 1, wouldStrip: 1, stripped: 0, failed: 0 });
    expect((await readFile(original)).equals(bytes)).toBe(true);
    expect(lines.join('\n')).toContain('would strip uploads/assets/ab/abcdef/original.jpg');
  });

  it('with apply, rewrites only the file carrying metadata, in place, with no temp file left', async () => {
    const dir = path.join(root, 'uploads/assets/ab/abcdef');
    const thumbBefore = await readFile(path.join(dir, 'thumb.jpg'));
    const report = await stripStoredImages({ root, apply: true, ...deps });
    expect(report).toMatchObject({ scanned: 2, clean: 1, stripped: 1, failed: 0 });
    const after = await sharp(await readFile(path.join(dir, 'original.jpg'))).metadata();
    expect(after.exif).toBeUndefined();
    expect({ width: after.width, height: after.height }).toEqual({ width: 300, height: 400 });
    expect((await readFile(path.join(dir, 'thumb.jpg'))).equals(thumbBefore)).toBe(true);
    expect((await readdir(dir)).some((f) => f.endsWith('.tmp'))).toBe(false);
    // Idempotent.
    expect(await stripStoredImages({ root, apply: true, ...deps })).toMatchObject({ stripped: 0, clean: 2 });
  });
});
