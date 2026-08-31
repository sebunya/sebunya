import '../config/env';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';

/**
 * Owner-directed product image assignment (2026-08-10).
 *
 * Uploads the owner's GoldPlus renders through the CANONICAL media pipeline
 * (MediaLibraryUseCase.upload → dedupe/variants → assignToProduct), exactly as
 * the admin media page would — same storage layout, same media_assets rows,
 * same usage records, so replacing any image later via /admin/media works
 * unchanged. Mapping is by slug and only where the render honestly depicts the
 * product; unmapped products keep their honest placeholder.
 *
 * Usage: ACTOR_USER_ID=<uuid> IMAGES_DIR=/import-images npx tsx src/scripts/assign-product-images.ts
 */
// MAPPING_FILE=<json of slug → filename> overrides the built-in map, so later
// catalogue rounds attach their own photographs through the same pipeline.
const MAPPING: Record<string, string> = process.env.MAPPING_FILE
  ? (JSON.parse(readFileSync(String(process.env.MAPPING_FILE), 'utf8')) as Record<string, string>)
  : {
  'generic-fast-charger': 'goldplus-charger-gp-101.webp',
  'heavy-duty-power-bank': 'goldplus-power-bank-with-handle-gp-x03.webp',
  'wireless-earbuds': 'goldplus-wireless-earbuds-gp-007.webp',
  'portable-audio-headset': 'goldplus-wireless-earbuds-gp-001.webp',
  'usb-3-flash-drive-128gb': 'goldplus-16gb-usb-flash-drive.webp',
  'reinforced-usb-c-cable': 'goldplus-usb-c-charger-kit-gp-104.webp',
};

const rowsOf = (r: unknown): Record<string, unknown>[] =>
  Array.isArray(r) ? (r as Record<string, unknown>[]) : ((r as { rows?: Record<string, unknown>[] })?.rows ?? []);

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const dir = String(process.env.IMAGES_DIR ?? '/import-images');

  const media = Registry.getInstance().mediaLibraryUseCase;

  for (const [slug, filename] of Object.entries(MAPPING)) {
    const path = join(dir, filename);
    if (!existsSync(path)) { console.log(`${slug}: SKIP — ${filename} not found`); continue; }

    const rows = rowsOf(await db.execute(sql`select id from products where slug = ${slug} limit 1`));
    const productId = rows[0]?.id as string | undefined;
    if (!productId) { console.log(`${slug}: SKIP — no such product`); continue; }

    const [outcome] = await media.upload({
      files: [{ filename, mime: 'image/webp', buffer: readFileSync(path) }],
      altText: null,
      caption: null,
      actorId,
    });
    if (outcome.kind !== 'STORED') { console.log(`${slug}: UPLOAD ${outcome.kind} (${'reason' in outcome ? outcome.reason : ''})`); continue; }

    const assigned = await media.assignToProduct(outcome.asset.id, productId);
    console.log(`${slug}: ${'url' in assigned ? `ASSIGNED ${assigned.url}${outcome.deduplicated ? ' (deduplicated)' : ''}` : 'ASSIGN_FAILED'}`);
  }
}

main()
  .then(async () => { await endDbConnection(); process.exit(0); })
  .catch(async (error) => { console.error('FAILED:', error instanceof Error ? error.message : error); await endDbConnection(); process.exit(1); });
