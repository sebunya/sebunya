import '../config/env';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Imports the owner's price list through the PIM pipeline — the same staged,
 * audited, rollback-able path the admin upload uses — never a raw insert.
 *
 * Rows arrive as JSON with the workbook's raw name preserved as the model
 * number and Cost/A/B/C/D carried into retail (D), floor (A) and the preserved
 * B/C tiers. Every product is created as a DRAFT: approval_status 'draft',
 * active false, out of stock. Nothing becomes sellable here.
 *
 * Four eyes: the pipeline refuses to let the uploader approve, so a second
 * admin identity (APPROVER_USER_ID) approves and applies. `create` is
 * idempotent on the row digest: a re-run resumes the same session.
 *
 *   ACTOR_USER_ID=<uploader> APPROVER_USER_ID=<second admin> ROWS_FILE=/import/rows.json [DRY_RUN=1] \
 *     npx tsx src/scripts/import-price-list.ts
 */
type Sess = { id: string; version: number; status: string };
const uuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v ?? ''));

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  const approverId = String(process.env.APPROVER_USER_ID ?? '').trim();
  if (!uuid(actorId)) throw new Error('ACTOR_USER_ID must be the uploading admin uuid.');
  const rows = JSON.parse(readFileSync(String(process.env.ROWS_FILE ?? '/import/rows.json'), 'utf8')) as Record<string, unknown>[];
  const dryRun = process.env.DRY_RUN === '1';
  const pim = Registry.getInstance().pimImportOperationsUseCase;
  const sessionOf = async (id: string): Promise<Sess> => (await pim.detail(id)).session as unknown as Sess;

  const created = await pim.create({
    name: `Price list 18-8-2026 (${rows.length} rows)`,
    sourceFilename: 'GoldPlus_PriceGuard_Pricing_Review_2026-08-31.csv',
    sourceSha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    mode: 'CREATE_ONLY',
    rows,
    actorId,
  });
  let s = ((created as { session?: Sess }).session ?? created) as Sess;
  console.log(`session ${s.id} (${s.status}), ${rows.length} rows`);

  if (['UPLOADED', 'MAPPED'].includes(s.status)) {
    if (s.status === 'UPLOADED') {
      await pim.saveMapping({
        id: s.id, expectedVersion: s.version, actorId,
        mapping: {
          sku: 'sku', modelNumber: 'modelNumber', name: 'name', slug: 'slug', categorySlug: 'categorySlug',
          shortDescription: 'shortDescription', longDescription: 'longDescription', retailPriceUgx: 'retail_D',
          floorPriceUgx: 'floor_A', tierBPriceUgx: 'tier_B', tierCPriceUgx: 'tier_C',
        },
      });
      s = await sessionOf(s.id);
    }
    await pim.preview({ id: s.id, expectedVersion: s.version, actorId });
    s = await sessionOf(s.id);
  }

  const detail = await pim.detail(s.id);
  const drows = (detail as { rows: Array<{ rowNumber: number; action: string | null; status: string; validationErrors: string[] | null }> }).rows;
  const tally: Record<string, number> = {};
  for (const r of drows) { const k = r.validationErrors?.length ? 'INVALID' : `${r.action ?? '?'}/${r.status}`; tally[k] = (tally[k] ?? 0) + 1; }
  console.log('rows:', JSON.stringify(tally));
  for (const r of drows.filter((x) => x.validationErrors?.length)) console.log(`  row ${r.rowNumber}: ${r.validationErrors!.join('; ')}`);
  if (dryRun) { console.log(`DRY RUN — session ${s.id} left at ${s.status}.`); return; }
  if (!uuid(approverId) || approverId === actorId) throw new Error('APPROVER_USER_ID must be a DIFFERENT admin uuid (four eyes).');

  if (s.status === 'READY_FOR_APPROVAL') {
    await pim.approve({ id: s.id, expectedVersion: s.version, actorId: approverId, decision: 'APPROVED', reason: 'Owner price list 18-8-2026; retail = Price D, floor = Price A; every product created as a draft.' });
    s = await sessionOf(s.id);
  }
  if (s.status === 'APPROVED') {
    const applied = await pim.apply({ id: s.id, expectedVersion: s.version, actorId: approverId });
    console.log('applied:', JSON.stringify(applied).slice(0, 300));
  } else {
    console.log(`nothing to apply: session is ${s.status}`);
  }
  const after: Record<string, number> = {};
  for (const r of await Registry.getInstance().pimImportRepo.rows(s.id)) after[r.status] = (after[r.status] ?? 0) + 1;
  console.log('rows by status:', JSON.stringify(after));
  console.log('SESSION_ID', s.id);
}

main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
