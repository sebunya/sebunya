import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { UpdateProductListingUseCase } from '../application/use-cases/products/UpdateProductListingUseCase';
import { polishProductName } from '../domain/products/ProductNamePolish';
import { actorUserId, rowsOf } from './lib/scriptHelpers';

/**
 * Names were built as "GoldPlus <Category> <price-list code>". The price
 * list's codes carry their own category suffix (PB = power bank, MC = memory
 * card, F = flash drive, CH = charger, BT = Bluetooth), so a customer read
 * "GoldPlus Power Bank GP-P07 PB". Drop the suffix the category word already
 * says, and write "TYPE C" the way people do. The model number keeps the
 * price list's exact text; only the display name changes, through the listing
 * use case the admin editor uses. Audited as a batch.
 *
 * Dry run by default (prints what would change). APPLY=1 writes.
 *
 *   [ACTOR_USER_ID=<uuid> APPLY=1] npx tsx src/scripts/polish-product-names.ts
 */
async function main(): Promise<void> {
  const apply = process.env.APPLY === '1';
  const actorId = actorUserId(apply);
  const rows = rowsOf(await db.execute(sql`select id, name from products where name like 'GoldPlus %'`));
  const changes: Array<{ id: string; from: string; to: string }> = [];
  for (const r of rows) { const to = polishProductName(String(r.name)); if (to !== r.name) changes.push({ id: String(r.id), from: String(r.name), to }); }
  console.log(`${changes.length} names would change${apply ? '' : ' (dry run; set APPLY=1 to write)'}`);
  for (const c of changes.slice(0, 20)) console.log(`  ${c.from} → ${c.to}`);
  if (!apply) return;
  const registry = Registry.getInstance();
  const listing = new UpdateProductListingUseCase(registry.productRepo, registry.attributeRepo);
  const done: typeof changes = [];
  for (const c of changes) {
    const result = await listing.execute({ productId: c.id, name: c.to });
    if (!result.ok) { console.log(`  FAILED ${c.from}: ${result.message}`); continue; }
    done.push(c);
  }
  if (done.length) await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId, action: 'PRODUCT_NAMES_POLISHED', entity: 'product_bulk_edit', entityId: randomUUID(), newState: { count: done.length, changes: done } });
  console.log(`renamed ${done.length} of ${changes.length}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
