import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { SharpGiftCardPhotoProcessor, takingTurns } from '../../apps/api/src/infrastructure/credit/SharpGiftCardPhotoProcessor';
import { GIFT_CARD_PHOTO_MAX_INPUT_PIXELS, GIFT_CARD_PHOTO_STORED_MAX_BYTES } from '../../apps/api/src/domain/credit/GiftCardPhoto';

// The real image library, on real pictures: what a phone sends is what this sees.
const sharp = createRequire(new URL('../../apps/api/package.json', import.meta.url))('sharp') as (typeof import('sharp'))['default'];
const processor = new SharpGiftCardPhotoProcessor();

describe('gift card photo processing (0201, real sharp)', () => {
  it('a landscape phone photo becomes a centred 1080 px square JPEG with no camera or location data', async () => {
    const camera = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 150, g: 204, b: 6 } } })
      .jpeg().withExif({ IFD0: { ImageDescription: 'lat 0.3476 lng 32.5825', Make: 'PhoneCam' } }).toBuffer();
    expect(camera.includes(Buffer.from('PhoneCam'))).toBe(true);
    const out = await processor.process(camera);
    if (!out.ok) throw new Error(out.reason);
    const meta = await sharp(out.image).metadata();
    expect([meta.format, meta.width, meta.height, out.width, out.height]).toEqual(['jpeg', 1080, 1080, 1080, 1080]);
    expect(meta.exif).toBeUndefined();
    expect(out.image.includes(Buffer.from('PhoneCam'))).toBe(false);
    expect(out.image.includes(Buffer.from('32.5825'))).toBe(false);
  });

  it('a small photo is kept at its own size (never blown up); a tiny one or a non-image is refused, with a reason', async () => {
    const small = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#000000' } }).png().toBuffer();
    expect(await processor.process(small)).toMatchObject({ ok: true, width: 480, height: 480 });
    const tiny = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#ffffff' } }).png().toBuffer();
    expect(await processor.process(tiny)).toEqual({ ok: false, reason: 'too_small' });
    expect(await processor.process(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({ ok: false, reason: 'not_an_image' });
    expect(await processor.process(Buffer.from('<?php echo 1; ?>'))).toEqual({ ok: false, reason: 'not_an_image' });
  });

  it('a transparent PNG becomes white (as the phone’s cropper makes it), not black', async () => {
    const clear = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await processor.process(clear);
    if (!out.ok) throw new Error(out.reason);
    const { data } = await sharp(out.image).raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(data[0], data[1], data[2])).toBeGreaterThan(245);
  });

  it('refuses a picture too large to decode safely before decoding it (the API container has 512 MB)', async () => {
    // A tiny file that declares a huge picture: the danger is the decode, not the download.
    const side = Math.ceil(Math.sqrt(GIFT_CARD_PHOTO_MAX_INPUT_PIXELS)) + 1;
    const bomb = await sharp({ create: { width: side, height: side, channels: 3, background: '#96CC06' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(200_000);
    const started = Date.now();
    expect(await processor.process(bomb)).toEqual({ ok: false, reason: 'too_large' });
    expect(Date.now() - started).toBeLessThan(2_000); // read from the header, not decoded
  });

  it('a photo full of fine detail still fits the column (quality steps down rather than failing)', async () => {
    const noise = Buffer.alloc(1080 * 1080 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const busy = await sharp(noise, { raw: { width: 1080, height: 1080, channels: 3 } }).png().toBuffer();
    const out = await processor.process(busy);
    if (!out.ok) throw new Error(out.reason);
    expect(out.image.length).toBeLessThanOrEqual(GIFT_CARD_PHOTO_STORED_MAX_BYTES);
  });

  it('many photos at once all come back (at most two are worked on at a time; the rest wait their turn)', async () => {
    const photo = await sharp({ create: { width: 900, height: 900, channels: 3, background: '#000000' } }).jpeg().toBuffer();
    const results = await Promise.all(Array.from({ length: 7 }, () => processor.process(photo)));
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe('two photos at a time (the memory guard’s queue)', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('never runs more than its limit, even when a newcomer arrives the moment one finishes; waiters go in order', async () => {
    const inTurn = takingTurns(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const finish: Array<() => void> = [];
    const job = (n: number) => inTurn(() => new Promise<void>((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      order.push(n);
      finish.push(() => { active -= 1; resolve(); });
    }));
    const all = [job(1), job(2), job(3)];
    await flush();
    expect(active).toBe(2);
    // The first finishes, and in the same moment another photo arrives. A queue that lets its count drop and rise
    // again admits the newcomer beside the one it just woke: three at once (this was the case before 2026-10-22).
    finish.shift()!();
    all.push(Promise.resolve().then(() => job(4)));
    await flush();
    expect(peak).toBe(2);
    while (finish.length) { finish.shift()!(); await flush(); }
    await Promise.all(all);
    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('a piece of work that fails still gives its place to the next', async () => {
    const inTurn = takingTurns(1);
    const failed = inTurn(() => Promise.reject(new Error('broken photo')));
    const next = inTurn(async () => 'next');
    await expect(failed).rejects.toThrow('broken photo');
    await expect(next).resolves.toBe('next');
  });
});
