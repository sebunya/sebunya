import { chmod, lstat, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

/**
 * Core of strip-stored-image-metadata.ts, kept free of env/DB side effects so it
 * can be unit-tested. New uploads have been stored without metadata since the
 * upload path started calling IMediaVariantGenerator.stripMetadata; originals
 * stored BEFORE that may still carry a phone's GPS fix, camera serial and
 * timestamps, and originals are served publicly.
 *
 * The strip itself is the upload path's own (SharpVariantGenerator.stripMetadata:
 * orientation baked into the pixels, ICC profile kept, everything else dropped),
 * injected here so this module never imports infrastructure.
 *
 * Only files that really carry metadata are rewritten, so a second run is a
 * no-op and the (already clean) renditions are never re-encoded.
 */

export type StripFn = (buffer: Buffer, mime: string) => Promise<Buffer | null>;

export interface ImageMeta {
  width?: number;
  height?: number;
  orientation?: number;
  exif?: Buffer;
  xmp?: Buffer;
  iptc?: Buffer;
}
export type ReadMetaFn = (buffer: Buffer) => Promise<ImageMeta>;

const MIME_BY_EXT: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** The types the upload path strips. GIF (animation) and AVIF pass through there too. */
export function mimeForFile(name: string): string | null {
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? null;
}

/** EXIF (which holds GPS), XMP or IPTC present, or a non-upright orientation tag still to bake in. */
export function carriesMetadata(meta: ImageMeta): boolean {
  return Boolean(meta.exif?.length || meta.xmp?.length || meta.iptc?.length) || (meta.orientation !== undefined && meta.orientation !== 1);
}

/** The size the image is SEEN at: orientations 5–8 are a 90° turn, so width and height swap. */
export function uprightSize(meta: ImageMeta): { width: number | null; height: number | null } {
  const w = meta.width ?? null;
  const h = meta.height ?? null;
  return meta.orientation && meta.orientation >= 5 && meta.orientation <= 8 ? { width: h, height: w } : { width: w, height: h };
}

export type StripOutcome =
  | { action: 'clean' }
  | { action: 'unsupported' }
  | { action: 'failed'; reason: string }
  | { action: 'stripped'; buffer: Buffer; bytesBefore: number; bytesAfter: number };

/**
 * Decides what to do with one stored file. A result is only accepted when it
 * carries no metadata AND keeps the upright size of the original; anything else
 * is 'failed' and the stored bytes stay as they are.
 */
export async function planStrip(buffer: Buffer, mime: string | null, deps: { strip: StripFn; readMeta: ReadMetaFn }): Promise<StripOutcome> {
  if (!mime) return { action: 'unsupported' };
  let before: ImageMeta;
  try {
    before = await deps.readMeta(buffer);
  } catch (err) {
    return { action: 'failed', reason: `unreadable: ${(err as Error).message}` };
  }
  if (!carriesMetadata(before)) return { action: 'clean' };
  const out = await deps.strip(buffer, mime).catch(() => null);
  if (!out || out.length === 0) return { action: 'failed', reason: 'strip engine returned nothing' };
  const after = await deps.readMeta(out).catch(() => null);
  if (!after) return { action: 'failed', reason: 'stripped output unreadable' };
  if (carriesMetadata(after)) return { action: 'failed', reason: 'metadata still present after strip' };
  const want = uprightSize(before);
  if (after.width !== want.width || after.height !== want.height) {
    return { action: 'failed', reason: `size changed ${want.width}x${want.height} -> ${after.width}x${after.height}` };
  }
  return { action: 'stripped', buffer: out, bytesBefore: buffer.length, bytesAfter: out.length };
}

/** Every regular image file under root (symlinks and dotfiles skipped), sorted for a stable report. */
export async function listImageFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && mimeForFile(e.name)) found.push(p);
    }
  };
  await walk(root);
  return found.sort();
}

/** Same directory, then rename: a reader never sees a half-written original. Mode is kept. */
async function replaceAtomically(path: string, buffer: Buffer): Promise<void> {
  const { mode } = await stat(path);
  const tmp = `${path}.strip-${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(tmp, buffer);
    await chmod(tmp, mode & 0o7777);
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export interface StripReport {
  scanned: number;
  clean: number;
  stripped: number;
  wouldStrip: number;
  failed: number;
  bytesSaved: number;
}

export async function stripStoredImages(args: {
  root: string;
  apply: boolean;
  strip: StripFn;
  readMeta: ReadMetaFn;
  log?: (line: string) => void;
}): Promise<StripReport> {
  const log = args.log ?? (() => undefined);
  const report: StripReport = { scanned: 0, clean: 0, stripped: 0, wouldStrip: 0, failed: 0, bytesSaved: 0 };
  for (const path of await listImageFiles(args.root)) {
    // One file at a time: originals can be tens of MB each.
    if (!(await lstat(path)).isFile()) continue;
    report.scanned += 1;
    const rel = path.slice(args.root.length).replace(/^\/+/, '');
    const outcome = await planStrip(await readFile(path), mimeForFile(path), args);
    if (outcome.action === 'clean' || outcome.action === 'unsupported') { report.clean += 1; continue; }
    if (outcome.action === 'failed') { report.failed += 1; log(`  LEFT AS IS ${rel}: ${outcome.reason}`); continue; }
    if (!args.apply) { report.wouldStrip += 1; log(`  would strip ${rel} (${outcome.bytesBefore} -> ${outcome.bytesAfter} B)`); continue; }
    await replaceAtomically(path, outcome.buffer);
    report.stripped += 1;
    report.bytesSaved += outcome.bytesBefore - outcome.bytesAfter;
    log(`  stripped ${rel} (${outcome.bytesBefore} -> ${outcome.bytesAfter} B)`);
  }
  return report;
}
