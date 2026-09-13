import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error — plain ESM helpers shared with the CLI
import { checkStaticImages, loadConfig } from '../../scripts/images/optimise-static-images.mjs';
// @ts-expect-error — plain ESM helpers shared with the CLI
import { imageDimensions } from '../../scripts/images/image-dimensions.mjs';

const root = resolve(__dirname, '../..');

/**
 * Static storefront images stay within budget (2026-09-13). Two nav icons had
 * shipped at 1024 and 2048 px for a 34 px box, and every product thumbnail in
 * the rails fetched its 1024 px master: nothing checked. This runs the same
 * check as `pnpm images:check`, with no native dependency.
 */
describe('static image budget', () => {
  it('every file in apps/web/public is within budget and every generated variant is present and current', () => {
    expect(checkStaticImages(loadConfig(), root)).toEqual([]);
  });

  it('the storefront wordmark is served from its generated WebP variants', () => {
    const nav = readFileSync(join(root, 'apps/web/src/components/GpNav.astro'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(root, 'apps/web/src/generated/static-images.json'), 'utf8'));
    for (const v of manifest['nav-wordmark'].variants) expect(nav).toContain(`${v.url} ${v.w}w`);
    expect(nav).not.toContain('src="/nav/gp-wordmark-cream-320.png"');
  });

  it('reads PNG, WebP (lossy, lossless, extended) and JPEG dimensions from headers', () => {
    const pub = join(root, 'apps/web/public');
    expect(imageDimensions(join(pub, 'nav/gp-wordmark-cream-320.png'))).toMatchObject({ width: 320, height: 92, format: 'png' });
    expect(imageDimensions(join(pub, 'nav/gp-wordmark-cream-160.webp'))).toMatchObject({ width: 160, height: 46, format: 'webp' });
    expect(imageDimensions(join(pub, 'hero/range.jpg'))).toMatchObject({ width: 760, height: 507, format: 'jpeg' });
    expect(imageDimensions(join(pub, 'hero/range-480.webp'))?.width).toBe(480);
  });

  it('flags an oversized image and a missing variant', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gp-img-'));
    mkdirSync(join(tmp, 'public/nav'), { recursive: true });
    mkdirSync(join(tmp, 'gen'), { recursive: true });
    // a 1024 x 1024 PNG header is enough for the check
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4); png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(1024, 16); png.writeUInt32BE(1024, 20);
    writeFileSync(join(tmp, 'public/nav/icon.png'), png);
    const config = {
      publicDir: 'public', manifest: 'gen/static-images.json',
      generate: [{ id: 'x', source: 'nav/source.png', output: 'nav/x-{w}.webp', widths: [100] }],
      budgets: [{ dir: 'nav', maxWidth: 400, maxBytes: 20000 }],
    };
    const problems: string[] = checkStaticImages(config, tmp);
    expect(problems.some((p) => p.includes('nav/icon.png: 1024px wide exceeds'))).toBe(true);
    expect(problems.some((p) => p.includes('source nav/source.png is missing'))).toBe(true);
  });
});
