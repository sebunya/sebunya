import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SharpVariantGenerator } from '../../apps/api/src/infrastructure/media/SharpVariantGenerator';

const sharp = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('sharp');

async function variantsFor(width: number) {
  const buffer = await sharp({ create: { width, height: width, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const out = await new SharpVariantGenerator().generate({
    buffer, mime: 'image/jpeg', checksum: 'x',
    saveVariant: async (key) => ({ url: `/u/${key}`, storageKey: key }),
  });
  return out.variants;
}

/**
 * The storefront resolves every photo through its pdp rendition. A 480–1023px
 * upload (an exactly-1000px photo meets the owner's spec) got none, so the
 * full original was served everywhere and the card/thumb renditions went unused.
 */
describe('a pdp rendition exists for every source at least card-sized', () => {
  it('a 1000px source gets pdp at 1000px, never upscaled', async () => {
    const pdp = (await variantsFor(1000)).find((v) => v.purpose === 'pdp' && v.format === 'webp');
    expect(pdp?.width).toBe(1000);
  }, 30_000);

  it('a 300px source still gets no card or pdp', async () => {
    const v = await variantsFor(300);
    expect(v.some((x) => x.purpose === 'pdp' || x.purpose === 'card')).toBe(false);
  }, 30_000);

  it('zoom is still never upscaled', async () => {
    expect((await variantsFor(1000)).some((x) => x.purpose === 'zoom')).toBe(false);
  }, 30_000);
});
