import sharp from 'sharp';
import type { IGiftCardPhotoProcessor } from '../../application/ports/IGiftCardPurchaseRepository';

/**
 * 0201: whatever a phone sent becomes a square JPEG of at most 1080 px. sharp drops every piece of metadata (EXIF,
 * GPS, camera) unless asked to keep it, and refuses anything that is not a real image. The crop was chosen on the
 * phone; a non-square upload is centred, never stretched.
 */
export class SharpGiftCardPhotoProcessor implements IGiftCardPhotoProcessor {
  async process(input: Buffer) {
    const meta = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata();
    if (!meta.width || !meta.height || !['jpeg', 'png', 'webp', 'heif', 'avif'].includes(String(meta.format))) throw new Error('PHOTO_NOT_AN_IMAGE');
    if (meta.width < 200 || meta.height < 200) throw new Error('PHOTO_TOO_SMALL');
    const size = Math.min(1080, meta.width, meta.height);
    const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate() // honour the phone's orientation, then forget it
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { image: data, width: info.width, height: info.height };
  }
}
