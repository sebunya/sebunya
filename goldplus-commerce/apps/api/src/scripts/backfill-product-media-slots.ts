import '../config/env';
import { writeFileSync } from 'node:fs';
import { endDbConnection } from '../infrastructure/db/client';
import { Registry } from '../infrastructure/Registry';
import { planBackfill } from '../domain/media/ProductMediaBackfill';

/**
 * Focus 4 — backfill each product's verified current primary into gallery slot 1.
 *
 *   DRY_RUN=1 (default)  plan only, write the report, change nothing
 *   DRY_RUN=0            apply, through ProductMediaUseCases.replaceMap (locked,
 *                        revision-checked, audited — the same path an admin click takes)
 *   ACTOR_USER_ID=<uuid> required to apply (the audit row names the operator)
 *   BATCH=<n>            products per page (default 100); resumes by product id
 *   REPORT=<path>        JSON report (default ./backfill-product-media-slots.report.json)
 *
 * Idempotent and bounded: a product with media_revision > 0 or any slotted row
 * is skipped, so a rerun never overwrites an operator's newer assignment.
 * Conflicts (URL-only primary, unready asset, two primaries) are reported, not
 * guessed. Supporting slots are never invented.
 */
async function main() {
  const dryRun = process.env.DRY_RUN !== '0';
  const actorId = String(process.env.ACTOR_USER_ID ?? '');
  if (!dryRun && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid to apply.');
  const batch = Math.max(1, Math.min(500, Number(process.env.BATCH ?? 100)));
  const reportPath = String(process.env.REPORT ?? './backfill-product-media-slots.report.json');

  const r = Registry.getInstance();
  const repo = r.productMediaRepo;
  const uc = r.productMediaUseCases;

  const report: Array<Record<string, unknown>> = [];
  const totals = { scanned: 0, assigned: 0, skipped: 0, conflicts: 0, stale: 0, failed: 0 };
  let afterId: string | null = null;
  for (;;) {
    const page = await repo.listUnmigratedProducts(batch, afterId);
    if (page.length === 0) break;
    for (const p of page) {
      afterId = p.productId;
      totals.scanned += 1;
      const snap = await repo.getSnapshot(p.productId);
      if (!snap) continue;
      const decision = planBackfill({ mediaRevision: snap.mediaRevision }, snap.rows.map((row) => ({
        imageId: row.imageId, assetId: row.assetId, slot: row.slot, isPrimary: row.isPrimary, displayOrder: row.displayOrder, altText: row.altText, assetReady: row.asset?.ready ?? false,
      })));
      if (decision.kind === 'SKIP_ALREADY_MIGRATED' || decision.kind === 'SKIP_NO_ROWS') { totals.skipped += 1; report.push({ sku: p.sku, decision: decision.kind }); continue; }
      if (decision.kind === 'CONFLICT') { totals.conflicts += 1; report.push({ sku: p.sku, decision: 'CONFLICT', code: decision.code, reason: decision.reason }); console.log(`CONFLICT ${p.sku}: ${decision.code} — ${decision.reason}`); continue; }
      if (dryRun) { totals.assigned += 1; report.push({ sku: p.sku, decision: 'WOULD_ASSIGN_COVER', assetId: decision.map[0].assetId }); continue; }
      const result = await uc.replaceMap({ productId: p.productId, expectedRevision: snap.mediaRevision, map: decision.map, actorId, action: 'BACKFILL_SLOT_1' });
      if (result.ok) { totals.assigned += 1; report.push({ sku: p.sku, decision: 'ASSIGNED_COVER', revision: result.mediaRevision }); }
      else if (result.code === 'STALE_REVISION') { totals.stale += 1; report.push({ sku: p.sku, decision: 'STALE_SKIPPED', reason: result.message }); }
      else { totals.failed += 1; report.push({ sku: p.sku, decision: 'FAILED', code: result.code, reason: result.message }); console.log(`FAILED ${p.sku}: ${result.code} — ${result.message}`); }
    }
  }
  writeFileSync(reportPath, JSON.stringify({ dryRun, at: new Date().toISOString(), totals, products: report }, null, 2));
  console.log(`${dryRun ? 'DRY RUN — nothing written.' : 'APPLIED.'} scanned ${totals.scanned}, ${dryRun ? 'would assign' : 'assigned'} ${totals.assigned}, skipped ${totals.skipped}, conflicts ${totals.conflicts}, stale ${totals.stale}, failed ${totals.failed}. Report: ${reportPath}`);
}

main()
  .then(async () => { await endDbConnection(); process.exit(0); })
  .catch(async (error) => { console.error('FAILED:', error instanceof Error ? error.message : error); await endDbConnection(); process.exit(1); });
