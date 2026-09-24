import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { SharpVariantGenerator } from '../../apps/api/src/infrastructure/media/SharpVariantGenerator';
import { MediaLibraryUseCase } from '../../apps/api/src/application/use-cases/media/MediaLibraryUseCase';
import { ADMIN_UPLOAD_MAX_BYTES } from '../../apps/api/src/interfaces/http/middleware/uploadLimit';

/**
 * Admin sweep batch 3 (2026-09-24) — uploads.
 *  - originals kept their EXIF (GPS, camera serial) and are served publicly;
 *  - multipart admin routes buffered any size of body (OOM risk for the API
 *    that also serves checkout).
 */
const sharp = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('sharp');

async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 300, height: 300, channels: 3, background: '#93D500' } })
    .withMetadata({ exif: { IFD0: { Make: 'AuditPhone', Model: 'X' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '0/1 20/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '32/1 35/1 0/1' } } })
    .jpeg()
    .toBuffer();
}

describe('stored originals carry no EXIF', () => {
  it('SharpVariantGenerator.stripMetadata removes EXIF from a JPEG', async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await new SharpVariantGenerator().stripMetadata(input, 'image/jpeg');
    expect(out).not.toBeNull();
    expect((await sharp(out!).metadata()).exif).toBeUndefined();
  });

  it('passes GIF through (null = keep the received bytes)', async () => {
    expect(await new SharpVariantGenerator().stripMetadata(Buffer.from('GIF89a'), 'image/gif')).toBeNull();
  });

  it('the library stores the stripped copy but dedupes on the received bytes', async () => {
    const input = await jpegWithGps();
    const saved: Array<{ name: string; buffer: Buffer }> = [];
    const created: any[] = [];
    const repo = {
      findByChecksum: vi.fn(async () => null),
      create: vi.fn(async (row: any) => { created.push(row); return { id: 'a1', ...row, variants: [] }; }),
      addVariants: vi.fn(async () => {}),
      findById: vi.fn(async () => null),
    };
    const storage = { saveAsset: vi.fn(async (dir: string, name: string, buffer: Buffer) => { saved.push({ name, buffer }); return { url: `/${dir}/${name}`, storageKey: `${dir}/${name}`, physicalPath: '' }; }), deleteByKey: vi.fn() };
    const variants = { generate: vi.fn(async () => ({ width: 300, height: 300, variants: [] })), stripMetadata: (b: Buffer, m: string) => new SharpVariantGenerator().stripMetadata(b, m) };
    const uc = new MediaLibraryUseCase(repo as any, storage as any, variants as any, {} as any);
    const [outcome] = await uc.upload({ files: [{ filename: 'gps.jpg', mime: 'image/jpeg', buffer: input }], actorId: 'admin' } as any);
    expect(outcome.kind).toBe('STORED');
    expect(repo.findByChecksum).toHaveBeenCalledWith(createHash('sha256').update(input).digest('hex'));
    expect(created[0].checksum).toBe(createHash('sha256').update(input).digest('hex'));
    expect((await sharp(saved[0].buffer).metadata()).exif).toBeUndefined();
    expect(created[0].byteSize).toBe(saved[0].buffer.length);
  });
});

describe('admin multipart routes cap the body while it streams', () => {
  it('60 MB, on every upload route', () => {
    expect(ADMIN_UPLOAD_MAX_BYTES).toBe(60 * 1024 * 1024);
    const media = readFileSync('apps/api/src/interfaces/http/routes/admin/media.ts', 'utf8');
    expect(media).toMatch(/routes\.post\('\/upload', requirePermissions\(\[PERMISSIONS\.MEDIA_MANAGE\]\), adminUploadLimit/);
    expect(media).toMatch(/routes\.post\('\/attach-by-code\/preview', requirePermissions\(\[PERMISSIONS\.PRODUCTS_WRITE\]\), adminUploadLimit/);
    expect(media).toMatch(/files\.length > ATTACH_BY_CODE_MAX_FILES/);
    expect(media).not.toMatch(/await Promise\.all\(\s*fileList\.map/);
    expect(readFileSync('apps/api/src/interfaces/http/routes/admin/media-imports.ts', 'utf8')).toMatch(/routes\.post\('\/', requirePermissions\(\[PERMISSIONS\.MEDIA_MANAGE\]\), adminUploadLimit/);
    const products = readFileSync('apps/api/src/interfaces/http/routes/admin/products.ts', 'utf8');
    expect(products).toMatch(/'\/:id\/images\/upload', requirePermissions\(\[PERMISSIONS\.PRODUCTS_WRITE\]\), adminUploadLimit/);
    expect(products).toMatch(/'\/:id\/media\/upload', requirePermissions\(\[PERMISSIONS\.PRODUCTS_WRITE\]\), adminUploadLimit/);
    const batteries = readFileSync('apps/api/src/interfaces/http/routes/admin/batteries.ts', 'utf8');
    expect(batteries).toMatch(/'\/catalogue\/:id\/evidence', requirePermissions\(\[PERMISSIONS\.BATTERIES_CATALOGUE_MANAGE\]\), adminUploadLimit/);
    expect(batteries).toMatch(/'\/compatibility\/:id\/evidence', requirePermissions\(\[PERMISSIONS\.BATTERIES_COMPAT_PROPOSE\]\), adminUploadLimit/);
    const batteryImports = readFileSync('apps/api/src/interfaces/http/routes/admin/battery-imports.ts', 'utf8');
    expect(batteryImports).toMatch(/'\/sheets', requirePermissions\(\[PERMISSIONS\.PIM_CREATE\]\), adminUploadLimit/);
    expect(batteryImports).toMatch(/routes\.post\('\/', requirePermissions\(\[PERMISSIONS\.PIM_CREATE\]\), adminUploadLimit/);
  });

  it('every multipart parse in the API sits behind the cap', () => {
    const dir = 'apps/api/src/interfaces/http/routes/admin';
    const parsing = readdirSync(dir).filter((f) => f.endsWith('.ts') && /parseBody\(/.test(readFileSync(path.join(dir, f), 'utf8')));
    for (const f of parsing) expect(readFileSync(path.join(dir, f), 'utf8'), f).toMatch(/adminUploadLimit/);
  });
});

describe('CSV downloads go through same-origin proxies', () => {
  it('no admin page links the browser at apiBase', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => { const p = path.join(dir, e); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.astro') ? [p] : []; });
    const offenders = walk('apps/web/src/pages/admin').filter((p) => /(href|src|action)=\{`\$\{apiBase\}/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
    expect(readFileSync('apps/web/src/pages/admin/media/gallery-queue.astro', 'utf8')).toMatch(/href="\/api\/admin\/media\/gallery-reconciliation\.csv"/);
    expect(readFileSync('apps/web/src/pages/api/admin/media-imports/[id]/results.csv.ts', 'utf8')).toMatch(/UUID_RE\.test\(id\)/);
  });
});
