/**
 * Image dimensions read from the file HEADER, without decoding a single pixel.
 *
 * Why this exists: a 20 KB PNG can declare 60,000 × 60,000 pixels. The byte cap
 * lets it through, and the first thing to decode it — sharp on the API, or the
 * customer's browser when the original is served — allocates gigabytes (a
 * decompression bomb). Reading the declared size costs a few bytes and settles
 * it before anything decodes.
 *
 * Pure: no sharp, no I/O. Returns null when the header cannot be read; the
 * caller decides what an unreadable header means.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

/** 50 megapixels: well above any product photograph (a 12 MP phone shot, a 45 MP studio frame), far below a bomb. */
export const MAX_IMAGE_PIXELS = 50_000_000;
/**
 * Longest edge. Stops a 100,000 × 400 strip that is under the pixel cap but absurd
 * to decode and lay out. 20,000 leaves room for a full-page phone screenshot
 * (1170 × 18,132 was refused at the first cap of 12,000).
 */
export const MAX_IMAGE_EDGE = 20_000;

export type ImageSizeVerdict =
  | { ok: true; dimensions: ImageDimensions | null }
  | { ok: false; dimensions: ImageDimensions; reason: 'TOO_MANY_PIXELS' }
  | { ok: false; dimensions: null; reason: 'UNREADABLE' };

/**
 * PNG, JPEG, GIF and WebP headers are strictly defined: every real image in
 * those formats has a readable size, so one without is refused — an unknown
 * size cannot be proven safe. AVIF (a box format whose size property can sit
 * anywhere in the metadata) is left to the decoder's own pixel cap.
 */
const STRICT_HEADER = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function checkImagePixelBudget(buffer: Buffer, mime: string): ImageSizeVerdict {
  const dimensions = readImageDimensions(buffer, mime);
  if (!dimensions) return STRICT_HEADER.has(mime) ? { ok: false, dimensions: null, reason: 'UNREADABLE' } : { ok: true, dimensions: null };
  const { width, height } = dimensions;
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    return { ok: false, dimensions, reason: 'TOO_MANY_PIXELS' };
  }
  return { ok: true, dimensions };
}

export function readImageDimensions(buffer: Buffer, mime: string): ImageDimensions | null {
  const found =
    mime === 'image/png' ? png(buffer)
      : mime === 'image/gif' ? gif(buffer)
        : mime === 'image/jpeg' ? jpeg(buffer)
          : mime === 'image/webp' ? webp(buffer)
            : mime === 'image/avif' ? avif(buffer)
              : null;
  if (!found || found.width <= 0 || found.height <= 0) return null;
  return found;
}

function png(b: Buffer): ImageDimensions | null {
  // Signature (8) + IHDR length (4) + 'IHDR' (4) + width (4) + height (4).
  if (b.length < 24 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gif(b: Buffer): ImageDimensions | null {
  if (b.length < 10) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

/**
 * Walks the marker segments to the first frame header (SOF0–SOF15 except
 * DHT/JPG/DAC). Bytes that are not a marker are SKIPPED, as libjpeg does
 * ("extraneous bytes before marker"): stopping there let a file hide a
 * 60,000 × 60,000 frame from this check while every decoder still read it.
 */
function jpeg(b: Buffer): ImageDimensions | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame header
    const length = b.readUInt16BE(i + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  return null;
}

function webp(b: Buffer): ImageDimensions | null {
  if (b.length < 30) return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') {
    // Frame tag (3) then start code 9d 01 2a, then 14-bit width/height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/**
 * AVIF (HEIF): the 'ispe' property box carries the image's spatial extent.
 * Of several (a grid and its tiles), the largest is the size a decoder builds.
 */
function avif(b: Buffer): ImageDimensions | null {
  let best: ImageDimensions | null = null;
  const limit = Math.min(b.length, 1024 * 1024); // the meta box sits near the front; bounded
  for (let i = 4; i + 16 <= limit; i++) {
    if (b[i] === 0x69 && b.toString('ascii', i, i + 4) === 'ispe') {
      const width = b.readUInt32BE(i + 8); // after version/flags
      const height = b.readUInt32BE(i + 12);
      if (!best || width * height > best.width * best.height) best = { width, height };
    }
  }
  return best;
}
