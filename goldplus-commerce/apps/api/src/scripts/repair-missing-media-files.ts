import '../config/env';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { LocalProductImageStorage } from '../infrastructure/storage/LocalProductImageStorage';
import { SharpVariantGenerator } from '../infrastructure/media/SharpVariantGenerator';
import { requireMediaVolume } from './requireMediaVolume';

/**
 * Puts back media files the database knows about but the shared volume has
 * lost (see requireMediaVolume for how that happens). Asset paths are derived
 * from the file's sha256, so the ORIGINAL bytes are matched to their asset by
 * checksum and rewritten at the recorded storage key, renditions included;
 * nothing in the database changes. Files that are not a known asset are
 * reported and left alone. Ends with the list of assets STILL missing, so the
 * owner knows which originals to find.
 *
 *   DRY_RUN=1 SOURCE_DIR=/import-images npx tsx src/scripts/repair-missing-media-files.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

async function main(): Promise<void> {
  const root = requireMediaVolume();
  const dir = String(process.env.SOURCE_DIR ?? '/import-images');
  const dryRun = process.env.DRY_RUN === '1';
  const r = Registry.getInstance();
  const storage = new LocalProductImageStorage(root);
  const variants = new SharpVariantGenerator();

  const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile() && !f.startsWith('.')).sort();
  let repaired = 0, present = 0, unknown = 0;
  for (const file of files) {
    const buffer = readFileSync(join(dir, file));
    const asset = await r.mediaLibraryRepo.findByChecksum(createHash('sha256').update(buffer).digest('hex'));
    if (!asset) { unknown += 1; console.log(`  NOT AN ASSET ${file}`); continue; }
    if (existsSync(join(root, asset.storageKey))) { present += 1; continue; }
    console.log(`  ${dryRun ? 'would restore' : 'restoring'} ${asset.storageKey} ← ${file}`);
    if (dryRun) continue;
    const assetDir = dirname(asset.storageKey);
    await storage.saveAsset(assetDir, basename(asset.storageKey), buffer);
    await variants.generate({ buffer, mime: asset.mime, checksum: asset.checksum, saveVariant: async (key, out) => { const s = await storage.saveAsset(assetDir, key, out); return { url: s.url, storageKey: s.storageKey }; } });
    repaired += 1;
  }
  console.log(`${files.length} files: restored ${repaired}, already on disk ${present}, not an asset ${unknown}${dryRun ? ' (DRY RUN)' : ''}`);

  const still = rowsOf(await db.execute(sql`select storage_key, filename from media_assets order by created_at`)).filter((a) => !existsSync(join(root, String(a.storage_key))));
  console.log(`assets still missing on disk: ${still.length}`);
  for (const a of still) console.log(`  MISSING ${a.storage_key}`);
  // Renditions are what the storefront serves; a recorded rendition without its
  // file is a broken image too.
  const variantRows = rowsOf(await db.execute(sql`select v.storage_key, v.purpose, v.format, a.filename from media_asset_variants v join media_assets a on a.id = v.asset_id order by a.created_at, v.purpose, v.format`));
  const lost = variantRows.filter((v) => !existsSync(join(root, String(v.storage_key))));
  console.log(`rendition rows ${variantRows.length}, missing on disk: ${lost.length}`);
  for (const v of lost) console.log(`  MISSING RENDITION ${v.storage_key}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
