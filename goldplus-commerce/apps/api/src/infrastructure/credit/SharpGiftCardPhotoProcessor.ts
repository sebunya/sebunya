import type { IGiftCardPhotoProcessor } from '../../application/ports/IGiftCardPhotoRepository';
import {
  GIFT_CARD_PHOTO_MAX_INPUT_PIXELS, GIFT_CARD_PHOTO_MAX_SIDE, GIFT_CARD_PHOTO_MIN_SIDE, GIFT_CARD_PHOTO_STORED_MAX_BYTES,
} from '../../domain/credit/GiftCardPhoto';

/**
 * 0201: whatever a phone sent becomes a square JPEG of at most 1080 px. sharp drops every piece of metadata (EXIF,
 * GPS, camera) and converts to sRGB unless asked otherwise, and refuses anything that is not a real image. The crop
 * was chosen on the phone; a non-square upload is centred, never stretched.
 *
 * Memory is the constraint that matters: the API runs in a 512 MB container and libvips works outside the JavaScript
 * heap. So the picture's declared size is checked before anything is decoded (GIFT_CARD_PHOTO_MAX_INPUT_PIXELS), it is
 * decoded once, libvips keeps no cache of it, and at most two photos are worked on at a time in a process.
 *
 * sharp is a native module, loaded on the first photo rather than when the API starts: if its binary were ever
 * missing from an image, photos would say "not available" and everything else would keep running. (CI proves it
 * loads inside the production image: the api-image job.)
 */
export { GIFT_CARD_PHOTO_STORED_MAX_BYTES };

type Sharp = (typeof import('sharp'))['default'];
let loaded: Promise<Sharp> | null = null;
const loadSharp = () => (loaded ??= import('sharp').then((m) => {
  const sharp = (m as unknown as { default?: Sharp }).default ?? (m as unknown as Sharp);
  sharp.cache(false); // every photo is new: a cache only holds memory
  return sharp;
}));

const QUALITIES = [84, 74, 64, 54];
const FORMATS = ['jpeg', 'png', 'webp', 'heif', 'avif'];

/**
 * At most `max` pieces of work at once; the rest wait their turn, in order. A finished piece hands its place straight
 * to the next one waiting (the count never drops and rises again), so a newcomer arriving in that moment cannot slip
 * in beside it and make it max + 1.
 */
export function takingTurns(max: number) {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async function inTurn<T>(work: () => Promise<T>): Promise<T> {
    if (running < max) running += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  };
}
/** Two photos at a time in a process (uploads are rate-limited, so the queue stays short). */
const inTurn = takingTurns(2);

export class SharpGiftCardPhotoProcessor implements IGiftCardPhotoProcessor {
  async process(input: Buffer, options: { whole?: boolean } = {}): ReturnType<IGiftCardPhotoProcessor['process']> {
    let sharp: Sharp;
    try { sharp = await loadSharp(); } catch { loaded = null; return { ok: false, reason: 'unavailable' }; }
    return inTurn(async () => {
      // The header only: format and declared size, before a single pixel is decoded.
      let meta;
      try { meta = await sharp(input, { limitInputPixels: false, failOn: 'error' }).metadata(); } catch { return { ok: false, reason: 'not_an_image' } as const; }
      if (!meta.width || !meta.height || !FORMATS.includes(String(meta.format))) return { ok: false, reason: 'not_an_image' } as const;
      if (meta.width * meta.height > GIFT_CARD_PHOTO_MAX_INPUT_PIXELS) return { ok: false, reason: 'too_large' } as const;
      if (meta.width < GIFT_CARD_PHOTO_MIN_SIDE || meta.height < GIFT_CARD_PHOTO_MIN_SIDE) return { ok: false, reason: 'too_small' } as const;

      // Decode once: oriented, centred and sized, as raw pixels; then encode, stepping down in quality only if needed.
      const side = Math.min(GIFT_CARD_PHOTO_MAX_SIDE, meta.width, meta.height);
      // A review photo keeps its whole frame within the same box (a buyer's photo of what arrived is rarely square, and
      // a centre square cut the edges off: 2026-10-29). A card photo, and a frame so narrow that its short side would fall
      // under the minimum the table allows, is centred to a square. Width and height swap under rotation; min/max do not.
      const scale = Math.min(1, GIFT_CARD_PHOTO_MAX_SIDE / Math.max(meta.width, meta.height));
      const whole = options.whole === true && Math.min(meta.width, meta.height) * scale >= GIFT_CARD_PHOTO_MIN_SIDE + 1;
      let raw;
      try {
        raw = await sharp(input, { limitInputPixels: GIFT_CARD_PHOTO_MAX_INPUT_PIXELS, failOn: 'error' })
          .rotate() // honour the phone's orientation, then forget it
          .resize(whole
            ? { width: GIFT_CARD_PHOTO_MAX_SIDE, height: GIFT_CARD_PHOTO_MAX_SIDE, fit: 'inside', withoutEnlargement: true }
            : { width: side, height: side, fit: 'cover', position: 'centre' })
          .flatten({ background: '#ffffff' }) // a transparent PNG becomes white, as the phone's cropper makes it
          .raw()
          .toBuffer({ resolveWithObject: true });
      } catch {
        return { ok: false, reason: 'not_an_image' } as const;
      }
      for (const quality of QUALITIES) {
        const { data, info } = await sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels } })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        if (data.length <= GIFT_CARD_PHOTO_STORED_MAX_BYTES) return { ok: true, image: data, width: info.width, height: info.height } as const;
      }
      return { ok: false, reason: 'too_detailed' } as const;
    });
  }
}
