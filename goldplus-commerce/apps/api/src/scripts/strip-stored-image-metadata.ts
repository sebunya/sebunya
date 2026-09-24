import { SharpVariantGenerator } from '../infrastructure/media/SharpVariantGenerator';
import { requireMediaVolume } from './requireMediaVolume';
import { stripStoredImages } from './stripStoredImageMetadata';

/**
 * Removes EXIF (GPS position, camera serial, timestamps), XMP and IPTC from
 * image originals ALREADY stored in the media volume, with the same strip new
 * uploads get (orientation baked into the pixels, colour profile kept). Only
 * files that still carry metadata are rewritten; each result is checked (no
 * metadata left, same upright size) before it atomically replaces the file.
 *
 * DRY RUN BY DEFAULT: it reports what it would change. Pass --apply to write.
 * Nothing in the database changes: storage keys and URLs stay the same, and
 * media_assets.checksum is of the RECEIVED bytes (as on upload), so dedupe and
 * repair-missing-media-files.ts keep working. The recorded byte size of a
 * rewritten asset will differ slightly from the file. Edge caches keep serving
 * the old bytes until they expire.
 *
 * Needs the media_uploads volume (see requireMediaVolume). Back the volume up
 * first; the rewrite is lossy re-encoding for JPEG/WebP (quality 95).
 *
 *   MEDIA_STORAGE_ROOT=/data/media npx tsx src/scripts/strip-stored-image-metadata.ts          # dry run
 *   MEDIA_STORAGE_ROOT=/data/media npx tsx src/scripts/strip-stored-image-metadata.ts --apply  # write
 */
async function main(): Promise<void> {
  const root = requireMediaVolume();
  const apply = process.argv.includes('--apply');
  const sharp = (await import('sharp')).default;
  const generator = new SharpVariantGenerator();
  const report = await stripStoredImages({
    root,
    apply,
    strip: (buffer, mime) => generator.stripMetadata(buffer, mime),
    readMeta: async (buffer) => sharp(buffer).metadata(),
    log: (line) => console.log(line),
  });
  console.log(
    `${report.scanned} image files: ${apply ? `stripped ${report.stripped}` : `would strip ${report.wouldStrip}`}, already clean ${report.clean}, left as is ${report.failed}` +
      (apply ? `, ${report.bytesSaved} bytes saved` : ' (DRY RUN — pass --apply to write)'),
  );
  if (report.failed > 0) process.exitCode = 2;
}

main().catch((e) => { console.error(e); process.exit(1); });
