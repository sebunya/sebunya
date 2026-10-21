import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { GIFT_CARD_PHOTO_STORED_MAX_BYTES, SharpGiftCardPhotoProcessor } from '../../apps/api/src/infrastructure/credit/SharpGiftCardPhotoProcessor';

// The real image library, on real pictures: what a phone sends is what this sees.
const sharp = createRequire(new URL('../../apps/api/package.json', import.meta.url))('sharp') as (typeof import('sharp'))['default'];
const processor = new SharpGiftCardPhotoProcessor();

describe('gift card photo processing (0201, real sharp)', () => {
  it('a landscape phone photo becomes a centred 1080 px square JPEG with no camera or location data', async () => {
    const camera = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 150, g: 204, b: 6 } } })
      .jpeg().withExif({ IFD0: { ImageDescription: 'lat 0.3476 lng 32.5825', Make: 'PhoneCam' } }).toBuffer();
    expect(camera.includes(Buffer.from('PhoneCam'))).toBe(true);
    const out = await processor.process(camera);
    const meta = await sharp(out.image).metadata();
    expect([meta.format, meta.width, meta.height, out.width, out.height]).toEqual(['jpeg', 1080, 1080, 1080, 1080]);
    expect(meta.exif).toBeUndefined();
    expect(out.image.includes(Buffer.from('PhoneCam'))).toBe(false);
    expect(out.image.includes(Buffer.from('32.5825'))).toBe(false);
  });

  it('a small photo is kept at its own size (never blown up); a tiny one or a non-image is refused', async () => {
    const small = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#000000' } }).png().toBuffer();
    expect((await processor.process(small)).width).toBe(480);
    const tiny = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await expect(processor.process(tiny)).rejects.toThrow('PHOTO_TOO_SMALL');
    await expect(processor.process(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).rejects.toThrow();
    await expect(processor.process(Buffer.from('<?php echo 1; ?>'))).rejects.toThrow();
  });

  it('a photo full of fine detail still fits the column (quality steps down rather than failing)', async () => {
    const noise = Buffer.alloc(1080 * 1080 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const busy = await sharp(noise, { raw: { width: 1080, height: 1080, channels: 3 } }).png().toBuffer();
    const out = await processor.process(busy);
    expect(out.image.length).toBeLessThanOrEqual(GIFT_CARD_PHOTO_STORED_MAX_BYTES);
  });
});
