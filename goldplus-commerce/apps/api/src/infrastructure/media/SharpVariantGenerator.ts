import { logger } from '../logging/logger';
import { IMediaVariantGenerator, MediaVariantRecord } from '../../application/ports/IMediaLibrary';

/**
 * Derivative generation via sharp, loaded lazily so an environment without the
 * native binary still stores originals: variants are a progressive enhancement,
 * never a gate on upload. GIFs pass through untouched (resizing animations is a
 * different problem than thumbnails).
 */

const PURPOSE_WIDTHS: Array<{ purpose: MediaVariantRecord['purpose']; width: number }> = [
  { purpose: 'thumb', width: 160 },
  { purpose: 'card', width: 480 },
  { purpose: 'pdp', width: 1024 },
  { purpose: 'zoom', width: 2048 },
];

const FORMATS: Array<{ format: MediaVariantRecord['format']; ext: string }> = [
  { format: 'avif', ext: 'avif' },
  { format: 'webp', ext: 'webp' },
  { format: 'jpeg', ext: 'jpg' },
];

let sharpModule: typeof import('sharp') | null | undefined;
async function loadSharp(): Promise<typeof import('sharp') | null> {
  if (sharpModule !== undefined) return sharpModule;
  try {
    sharpModule = (await import('sharp')).default as unknown as typeof import('sharp');
  } catch (err) {
    sharpModule = null;
    logger.warn({ err: (err as Error).message }, '[SharpVariantGenerator] sharp unavailable — storing originals only');
  }
  return sharpModule;
}

export class SharpVariantGenerator implements IMediaVariantGenerator {
  async generate(args: {
    buffer: Buffer;
    mime: string;
    checksum: string;
    saveVariant: (key: string, buffer: Buffer) => Promise<{ url: string; storageKey: string }>;
  }): Promise<{ width: number | null; height: number | null; variants: MediaVariantRecord[] }> {
    if (args.mime === 'image/gif') return { width: null, height: null, variants: [] };
    const sharp = await loadSharp();
    if (!sharp) return { width: null, height: null, variants: [] };

    try {
      const meta = await sharp(args.buffer).metadata();
      const sourceWidth = meta.width ?? null;
      const sourceHeight = meta.height ?? null;
      const variants: MediaVariantRecord[] = [];

      for (const { purpose, width } of PURPOSE_WIDTHS) {
        // Never upscale: a 500px original gets thumb+card only.
        if (sourceWidth !== null && width > sourceWidth) continue;
        for (const { format, ext } of FORMATS) {
          const pipeline = sharp(args.buffer).resize({ width, withoutEnlargement: true });
          const output =
            format === 'avif'
              ? await pipeline.avif({ quality: 55 }).toBuffer({ resolveWithObject: true })
              : format === 'webp'
                ? await pipeline.webp({ quality: 78 }).toBuffer({ resolveWithObject: true })
                : await pipeline.jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true });
          const saved = await args.saveVariant(`${purpose}.${ext}`, output.data);
          variants.push({
            purpose,
            format,
            width: output.info.width,
            height: output.info.height,
            byteSize: output.data.length,
            storageKey: saved.storageKey,
            url: saved.url,
          });
        }
      }
      return { width: sourceWidth, height: sourceHeight, variants };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[SharpVariantGenerator] generation failed — original kept');
      return { width: null, height: null, variants: [] };
    }
  }
}
