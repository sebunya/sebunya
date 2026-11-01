import '../config/env';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { actorUserId, rowsOf } from './lib/scriptHelpers';
import { parseStockQuantity, stockReason } from './lib/stockRunArgs';

/**
 * Owner's statement (2026-08-31): "we have 200 items for every product in
 * stock." Applied through the inventory adjustment use case — the same path
 * the admin Inventory page uses (mode 'set', status follows quantity) — and
 * audited per product with REASON (or the quantity used) as the reason. Batteries are
 * skipped here: their stock lives in the battery ledger (0125) and is counted
 * through the battery importer, or readiness reports NO_STOCK_LINKAGE.
 *
 *   ACTOR_USER_ID=<uuid> QUANTITY=200 [REASON=...] npx tsx src/scripts/set-stock-all.ts
 */

async function main(): Promise<void> {
  const actorId = actorUserId(true);
  const quantity = parseStockQuantity(process.env.QUANTITY);
  const reason = stockReason(quantity, process.env.REASON);
  const r = Registry.getInstance();
  const audit = new CreateAuditLogUseCase(r.auditRepo);
  const rows = rowsOf(await db.execute(sql`select p.id, p.name, p.stock_quantity from products p where not exists (select 1 from battery_profiles b where b.product_id = p.id) order by p.name`));
  let set = 0, refused = 0;
  for (const row of rows) {
    const outcome = await r.adjustStockUseCase.execute({ productId: String(row.id), mode: 'set', value: quantity });
    if (!outcome.ok) { refused += 1; console.log(`  refused ${row.name}: ${outcome.code} ${outcome.message}`); continue; }
    await audit.execute({ actorId, action: 'INVENTORY_ADJUSTED', entity: 'product', entityId: String(row.id), previousState: { stockQuantity: Number(row.stock_quantity) }, newState: { stockQuantity: quantity, mode: 'set', reason } });
    set += 1;
  }
  console.log(`stock set to ${quantity} on ${set} products, refused ${refused}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
