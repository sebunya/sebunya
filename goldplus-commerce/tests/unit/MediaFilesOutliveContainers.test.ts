import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { requireMediaVolume } from '../../apps/api/src/scripts/requireMediaVolume';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

/**
 * 2026-09-01: 20 product photos had database rows and no file. Ops containers
 * had stored into their own filesystem; the edge then cached the 404s for a
 * year; and the Caddyfile fix did not go live on reload because a single-file
 * bind mount keeps the old inode. Each of the three is pinned here.
 */
describe('media files outlive the container that stored them', () => {
  it('a media ops script refuses to run without the shared media volume', () => {
    const saved = process.env.MEDIA_STORAGE_ROOT;
    try {
      delete process.env.MEDIA_STORAGE_ROOT;
      expect(() => requireMediaVolume()).toThrow(/MEDIA_STORAGE_ROOT is unset/);
      process.env.MEDIA_STORAGE_ROOT = join(tmpdir(), 'goldplus-no-such-volume');
      expect(() => requireMediaVolume()).toThrow(/not mounted/);
      const dir = mkdtempSync(join(tmpdir(), 'goldplus-media-'));
      process.env.MEDIA_STORAGE_ROOT = dir;
      expect(requireMediaVolume()).toBe(dir);
    } finally {
      if (saved === undefined) delete process.env.MEDIA_STORAGE_ROOT; else process.env.MEDIA_STORAGE_ROOT = saved;
    }
  });

  it('both image-attaching scripts call the guard before touching anything', () => {
    for (const f of ['attach-images-by-code.ts', 'assign-product-images.ts']) {
      const src = read(`apps/api/src/scripts/${f}`);
      expect(src, f).toContain("import { requireMediaVolume } from './requireMediaVolume';");
      expect(src.indexOf('requireMediaVolume();'), f).toBeGreaterThan(0);
      expect(src.indexOf('requireMediaVolume();'), f).toBeLessThan(src.indexOf('mediaLibraryUseCase'));
    }
  });

  it('the edge never caches a missing upload: only an existing file is immutable', () => {
    const caddy = read('Caddyfile');
    const block = caddy.slice(caddy.indexOf('handle /uploads/*'), caddy.indexOf('file_server', caddy.indexOf('handle /uploads/*')));
    expect(block).toContain('@present file');
    expect(block).toMatch(/header @present Cache-Control "public, max-age=31536000, immutable"/);
    expect(block).toContain('@absent not file');
    expect(block).toMatch(/header @absent Cache-Control "no-store"/);
    expect(block).not.toMatch(/^\s*header Cache-Control/m);
  });

  it('a Caddyfile change on deploy recreates the container instead of reloading a stale inode', () => {
    const deploy = read('scripts/deploy-prod.sh');
    expect(deploy).toMatch(/git diff --name-only "\$PREV" HEAD \| grep -qx Caddyfile/);
    expect(deploy).toMatch(/up -d --force-recreate --no-deps caddy/);
    const executed = deploy.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(executed).not.toMatch(/caddy reload/);
  });
});
