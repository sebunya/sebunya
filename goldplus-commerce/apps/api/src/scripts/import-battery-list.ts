import '../config/env';
import { readFileSync } from 'node:fs';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Stages the owner's battery price list through the battery importer (0125).
 *
 * The workbook names batteries by DEVICE ("GP - IP 11 PRO BATTERY"), which is
 * exactly the case the module holds for review: a battery cannot publish
 * until the printed pack code is recorded. So this creates draft/review
 * batteries with the stock label as an alias and Price D as the price; it
 * publishes nothing.
 *
 *   ACTOR_USER_ID=<uuid> ROWS_FILE=/import/batteries.json [DRY_RUN=1] npx tsx src/scripts/import-battery-list.ts
 */
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const rows = JSON.parse(readFileSync(String(process.env.ROWS_FILE ?? '/import/batteries.json'), 'utf8')) as Array<{ item: string; price: number; sourceNo: string }>;
  const dryRun = process.env.DRY_RUN === '1';
  const uc = Registry.getInstance().batteryImportUseCases;
  const csv = ['ITEM,PRICE,CATEGORY,SOURCE_NO', ...rows.map((r) => `"${r.item.replace(/"/g, '""')}",${r.price},Phone Battery,${r.sourceNo}`)].join('\n');

  const up = await uc.upload({
    importType: 'BATTERY_CATALOGUE', name: `Battery price list 18-8-2026 (${rows.length})`, filename: 'batteries-18-8-2026.csv',
    mime: 'text/csv', buffer: Buffer.from(csv, 'utf8'), sheetName: null, actorId,
  } as never);
  const id = up.session.id;
  console.log(`session ${id} uploaded, ${rows.length} rows`);
  await uc.saveMapping({ id, expectedVersion: up.session.version, mapping: { sourceItem: 'ITEM', retailPriceUgx: 'PRICE', batteryCategory: 'CATEGORY', sourceNo: 'SOURCE_NO' }, actorId } as never);
  let version = (await uc.detail(id)).session.version;
  const preview = await uc.preview({ id, expectedVersion: version, actorId });
  const prows = (preview as unknown as { rows: Array<{ action: string; hold: unknown; errors: string[]; warnings: string[] }> }).rows;
  const tally: Record<string, number> = {};
  for (const r of prows) { const k = r.errors.length ? 'INVALID' : r.hold ? `HELD` : r.action; tally[k] = (tally[k] ?? 0) + 1; }
  console.log('preview:', JSON.stringify(tally));
  for (const r of prows.filter((x) => x.errors.length).slice(0, 15)) console.log('  error:', r.errors.join('; '));
  const holds = prows.filter((x) => x.hold).slice(0, 5); for (const h of holds) console.log('  held:', JSON.stringify(h.hold).slice(0, 160));
  if (dryRun) { console.log('DRY RUN — stopping before approval.'); return; }
  version = (await uc.detail(id)).session.version;
  await uc.approve({ id, expectedVersion: version, actorId, decision: 'APPROVED', reason: 'Owner battery price list 18-8-2026; device-named rows stay in review until pack codes are recorded.' });
  version = (await uc.detail(id)).session.version;
  const applied = await uc.apply({ id, expectedVersion: version, actorId, canRecordCost: false });
  console.log('applied:', JSON.stringify(applied).slice(0, 400));
  console.log('SESSION_ID', id);
}

main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
