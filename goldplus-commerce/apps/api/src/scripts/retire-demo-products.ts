import '../config/env';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { products } from '../infrastructure/db/schema/products';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

/**
 * The eight products the shop launched with are not on the owner's price list.
 * Their names and prices were placeholders ("Heavy Duty Power Bank",
 * UGX 185,000) and, next to the real catalogue, they mislead: a real GoldPlus
 * power bank on the list is UGX 40,000–280,000 under its own code. They are
 * hidden (rejected, inactive), not deleted: order history keeps pointing at
 * them, and one click in admin brings any of them back.
 *
 *   ACTOR_USER_ID=<uuid> npx tsx src/scripts/retire-demo-products.ts
 */
const DEMO_SKUS = ['PWR-CHG-001', 'PWR-PBK-003', 'PWR-CBL-002', 'STR-FL-006', 'SND-EP-001', 'SND-HD-007', 'SND-SPK-004', 'ACC-MT-005'];
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const r = Registry.getInstance();
  const rows = await db.select({ id: products.id, sku: products.sku, name: products.name }).from(products).where(and(inArray(products.sku, DEMO_SKUS), eq(products.active, true)));
  const ids = rows.map((x) => String(x.id));
  const changed = await r.productRepo.setApprovalMany(ids, 'rejected', false);
  await new CreateAuditLogUseCase(r.auditRepo).execute({ actorId, action: 'PRODUCTS_BULK_APPROVAL', entity: 'product_bulk_approval', entityId: randomUUID(), previousState: { approvalStatus: 'approved', active: true }, newState: { approvalStatus: 'rejected', active: false, changed: changed.length, productIds: changed, reason: 'Launch placeholders retired: not on the 18-8-2026 price list, placeholder names and prices next to the real catalogue. Reversible in admin.' } });
  console.log(`retired ${changed.length}: ${rows.map((x) => x.name).join(', ')}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
