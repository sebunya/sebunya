import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SharpVariantGenerator } from '../../apps/api/src/infrastructure/media/SharpVariantGenerator';

const sharp = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('sharp');

/**
 * A camera photo is decoded once per rendition (12) plus the metadata strip, outside the JS heap, in a 512 MB API
 * container that also serves checkout. Two uploads at once could take a replica down (2026-10-22 review): photos are
 * now processed one at a time per process, and libvips keeps no cache.
 */
describe('product photos are processed one at a time', () => {
  it('two uploads at once never interleave their renditions', async () => {
    const gen = new SharpVariantGenerator();
    const photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#96CC06' } }).jpeg().toBuffer();
    const order: string[] = [];
    const run = (who: string) => gen.generate({
      buffer: photo, mime: 'image/jpeg', checksum: who.repeat(64).slice(0, 64),
      saveVariant: async (key: string) => { order.push(who); return { url: `/${who}/${key}`, storageKey: `${who}/${key}` }; },
    });
    await Promise.all([run('a'), run('b')]);
    const firstB = order.indexOf('b');
    expect(firstB).toBeGreaterThan(0);
    expect(order.slice(firstB)).not.toContain('a');
  });
});
