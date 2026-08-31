import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

/**
 * Owner's instruction (2026-08-31): every product on the price list is to be
 * published; images are the only thing allowed to be missing. Publishes every
 * DRAFT that has stock recorded — the same rule as the admin bulk approval —
 * through the same repository method, audited as one batch.
 *
 *   ACTOR_USER_ID=<uuid> npx tsx src/scripts/publish-drafts-with-stock.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const r = Registry.getInstance();
  const ids = rowsOf(await db.execute(sql`select id from products where approval_status = 'draft' and stock_quantity > 0 order by name`)).map((x) => String(x.id));
  const changed = await r.productRepo.setApprovalMany(ids, 'approved', true, { requireStock: true });
  await new CreateAuditLogUseCase(r.auditRepo).execute({ actorId, action: 'PRODUCTS_BULK_APPROVAL', entity: 'product_bulk_approval', entityId: randomUUID(), previousState: { approvalStatus: 'draft', active: false }, newState: { approvalStatus: 'approved', active: true, requireStock: true, requested: ids.length, changed: changed.length, productIds: changed, reason: 'Owner: all products on the price list are to be published; images are the only permitted gap (2026-08-31).' } });
  console.log(`published ${changed.length} of ${ids.length} drafts`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
