import type { IGiftCardPhotoProcessor } from '../../application/ports/IGiftCardPurchaseRepository';

/**
 * 0201: whatever a phone sent becomes a square JPEG of at most 1080 px. sharp drops every piece of metadata (EXIF,
 * GPS, camera) unless asked to keep it, and refuses anything that is not a real image. The crop was chosen on the
 * phone; a non-square upload is centred, never stretched.
 *
 * sharp is a native module, loaded on the first photo rather than when the API starts: if its binary were ever
 * missing from an image, photos would say "not available" and everything else would keep running. (CI proves it
 * loads inside the production image: the api-image job.)
 */
type Sharp = (typeof import('sharp'))['default'];
let loaded: Promise<Sharp> | null = null;
const loadSharp = () => (loaded ??= import('sharp').then((m) => ((m as unknown as { default?: Sharp }).default ?? (m as unknown as Sharp))));

/** The column allows 1,500,000 bytes; a very detailed photo steps down in quality until it fits under this. */
export const GIFT_CARD_PHOTO_STORED_MAX_BYTES = 1_400_000;

export class SharpGiftCardPhotoProcessor implements IGiftCardPhotoProcessor {
  async process(input: Buffer) {
    let sharp: Sharp;
    try { sharp = await loadSharp(); } catch { loaded = null; throw new Error('PHOTO_PROCESSOR_UNAVAILABLE'); }
    const meta = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata();
    if (!meta.width || !meta.height || !['jpeg', 'png', 'webp', 'heif', 'avif'].includes(String(meta.format))) throw new Error('PHOTO_NOT_AN_IMAGE');
    if (meta.width < 200 || meta.height < 200) throw new Error('PHOTO_TOO_SMALL');
    const size = Math.min(1080, meta.width, meta.height);
    for (const quality of [84, 74, 64, 54]) {
      const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
        .rotate() // honour the phone's orientation, then forget it
        .resize(size, size, { fit: 'cover', position: 'centre' })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= GIFT_CARD_PHOTO_STORED_MAX_BYTES) return { image: data, width: info.width, height: info.height };
    }
    throw new Error('PHOTO_TOO_DETAILED');
  }
}
