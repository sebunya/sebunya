import '../config/env';
import { readFileSync } from 'node:fs';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Loads supplier costs through the same path as /admin/product-costs: the
 * all-or-nothing ImportProductCostsUseCase (preview first, then commit) and the
 * PRODUCT_COSTS_IMPORTED / _REJECTED audit row the admin route writes.
 *
 * Rows: [{ identifier (sku or product id), costPriceUgx, effectiveFrom
 * (YYYY-MM-DD), currency?, note? }]. Cost is secured data — nothing here is
 * printed beyond counts and per-row errors.
 *
 *   ACTOR_USER_ID=<admin uuid> ROWS_FILE=/import/costs.json SOURCE=<label> [DRY_RUN=1] \
 *     npx tsx src/scripts/import-product-costs.ts
 */
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the admin uuid.');
  const rows = JSON.parse(readFileSync(String(process.env.ROWS_FILE ?? '/import/costs.json'), 'utf8'));
  const source = String(process.env.SOURCE ?? 'ops-import').slice(0, 120);
  const dryRun = process.env.DRY_RUN === '1';
  const registry = Registry.getInstance();

  const preview = await registry.importProductCostsUseCase.execute({ rows, source, enteredBy: actorId, dryRun: true });
  console.log(`preview: ${preview.totalRows} rows, accepted=${preview.accepted}, corrections=${preview.plan.filter((p) => p.isCorrection).length}, errors=${preview.errors.length}`);
  for (const e of preview.errors) console.log(`  row ${e.rowNumber} ${e.identifier}: ${e.message}`);
  if (dryRun || !preview.accepted) { console.log(dryRun ? 'DRY RUN — nothing written.' : 'Refused — nothing written.'); return; }

  const result = await registry.importProductCostsUseCase.execute({ rows, source, enteredBy: actorId, dryRun: false });
  await registry.createAuditLogUseCase.execute({
    actorId,
    action: result.accepted ? 'PRODUCT_COSTS_IMPORTED' : 'PRODUCT_COSTS_IMPORT_REJECTED',
    entity: 'product_cost_entries',
    entityId: source,
    previousState: null,
    newState: {
      source,
      totalRows: result.totalRows,
      applied: result.applied,
      corrections: result.plan.filter((p) => p.isCorrection).length,
      errorCount: result.errors.length,
      firstErrors: result.errors.slice(0, 5),
      products: result.plan.slice(0, 50).map((p) => ({ productId: p.productId, sku: p.sku, costPriceUgx: p.costPriceUgx, effectiveFrom: p.effectiveFrom })),
    },
  });
  console.log(`applied: ${result.applied} of ${result.totalRows}, accepted=${result.accepted}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => endDbConnection());
