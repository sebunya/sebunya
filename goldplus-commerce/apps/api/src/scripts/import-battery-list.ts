import '../config/env';
import { readFileSync } from 'node:fs';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Stages the owner's battery price list through the battery importer (0125),
 * in the two stages the module is built around:
 *   1. BATTERY_CATALOGUE — the stock label becomes a draft battery with the
 *      label kept as an alias. The workbook names batteries by DEVICE
 *      ("GP - IP 11 PRO BATTERY"), which the module deliberately holds for
 *      review until the printed pack code is recorded; it publishes nothing.
 *   2. PRICE_UPDATE — Price D, resolved through that alias.
 * Four eyes: the uploader cannot approve; APPROVER_USER_ID does.
 *
 *   ACTOR_USER_ID=<uploader> APPROVER_USER_ID=<second admin> ROWS_FILE=/import/batteries.json [DRY_RUN=1] [STAGE=catalogue|price|stock] [QUANTITY=200] \
 *     npx tsx src/scripts/import-battery-list.ts
 */
type Row = { item: string; price: number; sourceNo: string };
const uuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v ?? ''));
const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

async function runSession(kind: 'BATTERY_CATALOGUE' | 'PRICE_UPDATE' | 'STOCK_COUNT', rows: Row[], actorId: string, approverId: string, dryRun: boolean) {
  const uc = Registry.getInstance().batteryImportUseCases;
  const count = Number(process.env.QUANTITY ?? 200);
  const header = kind === 'BATTERY_CATALOGUE' ? 'ITEM,CATEGORY,SOURCE_NO' : kind === 'PRICE_UPDATE' ? 'ITEM,PRICE' : 'ITEM,COUNT,REASON';
  const lines = rows.map((r) => kind === 'BATTERY_CATALOGUE' ? `${csvCell(r.item)},Phone Battery,${r.sourceNo}` : kind === 'PRICE_UPDATE' ? `${csvCell(r.item)},${r.price}` : `${csvCell(r.item)},${count},${csvCell('Owner: 200 units of every product in stock (2026-08-31)')}`);
  const up = await uc.upload({
    importType: kind, name: `Battery price list 18-8-2026 — ${kind} (${rows.length})`, filename: `batteries-18-8-2026-${kind.toLowerCase()}.csv`,
    mime: 'text/csv', buffer: Buffer.from([header, ...lines].join('\n'), 'utf8'), sheetName: null, actorId,
  } as never);
  let s = (up as { session: { id: string; version: number; status: string } }).session;
  console.log(`[${kind}] session ${s.id} (${s.status}), ${rows.length} rows`);
  if (s.status === 'UPLOADED') {
    const mapping = kind === 'BATTERY_CATALOGUE' ? { sourceItem: 'ITEM', batteryCategory: 'CATEGORY', sourceNo: 'SOURCE_NO' } : kind === 'PRICE_UPDATE' ? { batteryCode: 'ITEM', retailPriceUgx: 'PRICE' } : { batteryCode: 'ITEM', countedQuantity: 'COUNT', reason: 'REASON' };
    await uc.saveMapping({ id: s.id, expectedVersion: s.version, mapping, actorId } as never);
    s = (await uc.detail(s.id)).session as typeof s;
  }
  if (['MAPPED'].includes(s.status)) {
    const preview = await uc.preview({ id: s.id, expectedVersion: s.version, actorId });
    const prows = (preview as unknown as { rows: Array<{ proposedAction: string; status: string; validationErrors: string[]; validationWarnings: string[] }> }).rows;
    const tally: Record<string, number> = {};
    for (const r of prows) { const k = r.validationErrors?.length ? 'INVALID' : `${r.proposedAction}/${r.status}`; tally[k] = (tally[k] ?? 0) + 1; }
    console.log(`[${kind}] preview:`, JSON.stringify(tally));
    for (const r of prows.filter((x) => x.validationErrors?.length).slice(0, 8)) console.log('   error:', r.validationErrors.join('; '));
    for (const r of prows.filter((x) => x.status === 'HELD').slice(0, 3)) console.log('   held:', (r.validationWarnings ?? []).join('; ').slice(0, 200));
    s = (await uc.detail(s.id)).session as typeof s;
  } else {
    console.log(`[${kind}] session already at ${s.status}`);
  }
  if (dryRun) { console.log(`[${kind}] DRY RUN — left at ${s.status}.`); return; }
  if (s.status === 'READY_FOR_APPROVAL') {
    await uc.approve({ id: s.id, expectedVersion: s.version, actorId: approverId, decision: 'APPROVED', reason: `Owner battery price list 18-8-2026 (${kind}); device-named rows stay in review until pack codes are recorded.` });
    s = (await uc.detail(s.id)).session as typeof s;
  }
  if (s.status === 'APPROVED') {
    const applied = await uc.apply({ id: s.id, expectedVersion: s.version, actorId: approverId, canRecordCost: false });
    console.log(`[${kind}] applied:`, JSON.stringify(applied).slice(0, 300));
  } else {
    console.log(`[${kind}] nothing to apply: ${s.status}`);
  }
}

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  const approverId = String(process.env.APPROVER_USER_ID ?? '').trim();
  if (!uuid(actorId)) throw new Error('ACTOR_USER_ID must be the uploading admin uuid.');
  const dryRun = process.env.DRY_RUN === '1';
  if (!dryRun && (!uuid(approverId) || approverId === actorId)) throw new Error('APPROVER_USER_ID must be a DIFFERENT admin uuid (four eyes).');
  const rows = JSON.parse(readFileSync(String(process.env.ROWS_FILE ?? '/import/batteries.json'), 'utf8')) as Row[];
  const stage = String(process.env.STAGE ?? 'catalogue');
  if (stage === 'catalogue') await runSession('BATTERY_CATALOGUE', rows, actorId, approverId, dryRun);
  else if (stage === 'stock') await runSession('STOCK_COUNT', rows, actorId, approverId, dryRun);
  else await runSession('PRICE_UPDATE', rows, actorId, approverId, dryRun);
}

main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
