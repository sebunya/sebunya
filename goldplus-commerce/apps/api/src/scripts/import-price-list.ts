import '../config/env';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Imports the owner's price list through the PIM pipeline — the same staged,
 * audited, rollback-able path the admin upload uses — never a raw insert.
 *
 * Rows arrive as JSON (see scratchpad/catalogue-import-rows.json) with the
 * workbook's raw name preserved as the model number and its Cost/A/B/C/D
 * carried into retail (D), floor (A) and the preserved B/C tiers. Every product
 * is created as a DRAFT: approval_status 'draft', active false, out of stock.
 * Nothing becomes sellable here.
 *
 *   ACTOR_USER_ID=<uuid> ROWS_FILE=/import/rows.json [DRY_RUN=1] npx tsx src/scripts/import-price-list.ts
 *
 * DRY_RUN stops after the preview and prints every row error.
 */
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const rows = JSON.parse(readFileSync(String(process.env.ROWS_FILE ?? '/import/rows.json'), 'utf8')) as Record<string, unknown>[];
  const dryRun = process.env.DRY_RUN === '1';
  const pim = Registry.getInstance().pimImportOperationsUseCase;

  const created = await pim.create({
    name: `Price list 18-8-2026 (${rows.length} rows)`,
    sourceFilename: 'GoldPlus_PriceGuard_Pricing_Review_2026-08-31.csv',
    sourceSha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    mode: 'CREATE_ONLY',
    rows,
    actorId,
  });
  const sess = ((created as { session?: { id: string; version: number } }).session ?? created) as { id: string; version: number };
  const id = sess.id;
  let version = sess.version;
  console.log(`session ${id} created, ${rows.length} rows`);

  await pim.saveMapping({
    id, expectedVersion: version, actorId,
    mapping: {
      sku: 'sku', modelNumber: 'modelNumber', name: 'name', slug: 'slug', categorySlug: 'categorySlug',
      shortDescription: 'shortDescription', longDescription: 'longDescription', retailPriceUgx: 'retail_D',
      floorPriceUgx: 'floor_A', tierBPriceUgx: 'tier_B', tierCPriceUgx: 'tier_C',
    },
  });
  version = (await pim.detail(id)).session.version;
  const preview = await pim.preview({ id, expectedVersion: version, actorId });
  const previewRows = ((preview as { rows?: unknown[] }).rows ?? preview) as Array<{ rowNumber: number; action: string; errors: string[] }>;
  const byAction: Record<string, number> = {};
  for (const r of previewRows) byAction[r.errors.length ? 'INVALID' : r.action] = (byAction[r.errors.length ? 'INVALID' : r.action] ?? 0) + 1;
  console.log('preview:', JSON.stringify(byAction));
  for (const r of previewRows.filter((x) => x.errors.length)) console.log(`  row ${r.rowNumber}: ${r.errors.join('; ')}`);
  if (dryRun) { console.log('DRY RUN — stopping before approval. Session left in preview state.'); return; }

  version = (await pim.detail(id)).session.version;
  await pim.approve({ id, expectedVersion: version, actorId, decision: 'APPROVED', reason: 'Owner price list 18-8-2026; retail = Price D, floor = Price A; all rows draft.' });
  version = (await pim.detail(id)).session.version;
  const applied = await pim.apply({ id, expectedVersion: version, actorId });
  console.log('applied:', JSON.stringify(applied));
  const rowsAfter = await Registry.getInstance().pimImportRepo.rows(id);
  const status: Record<string, number> = {};
  for (const r of rowsAfter) status[r.status] = (status[r.status] ?? 0) + 1;
  console.log('rows by status:', JSON.stringify(status));
  console.log('SESSION_ID', id);
}

main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
