import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { MAX_ONLY_SKUS, parseOnly } from './skuSelection';

/**
 * Put NAMED draft products back on sale, e.g. the ones a photo batch just covered.
 * Same repository method as the admin bulk-approval button (stock required), audited the same way.
 * Use this, not publish-drafts-with-stock.ts, which approves EVERY draft with stock.
 * Order for a photo batch: approve-skus → demo-gallery-frames MODE=remove → attach-images-by-code.
 * Dry run by default.   ONLY=SKU1,SKU2 [APPLY=1] ACTOR_USER_ID=<uuid> npx tsx src/scripts/approve-skus.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));
async function main(): Promise<void> {
  const only = parseOnly(process.env.ONLY);
  if (only.size === 0 || only.size > MAX_ONLY_SKUS) throw new Error(`ONLY must list between 1 and ${MAX_ONLY_SKUS} SKUs.`);
  const apply = process.env.APPLY === '1';
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (apply && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('APPLY=1 needs ACTOR_USER_ID.');
  const rows = rowsOf(await db.execute(sql`select id, sku, approval_status, active, stock_quantity from products order by sku`)).filter((r) => only.has(String(r.sku).toUpperCase()));
  for (const r of rows) console.log(`  ${r.sku}: ${r.approval_status}, ${r.active ? 'on sale' : 'off sale'}, stock ${r.stock_quantity}`);
  const missing = [...only].filter((s) => !rows.some((r) => String(r.sku).toUpperCase() === s));
  if (missing.length) console.log(`  not found: ${missing.join(', ')}`);
  if (!apply) { console.log(`DRY RUN: would approve ${rows.length} product(s). Nothing changed.`); return; }
  const r = Registry.getInstance();
  const ids = rows.map((x) => String(x.id));
  const changed = await r.productRepo.setApprovalMany(ids, 'approved', true, { requireStock: true });
  await new CreateAuditLogUseCase(r.auditRepo).execute({ actorId, action: 'PRODUCTS_BULK_APPROVAL', entity: 'product_bulk_approval', entityId: randomUUID(), previousState: { approvalStatus: 'draft', active: false }, newState: { approvalStatus: 'approved', active: true, requireStock: true, requested: ids.length, changed: changed.length, productIds: changed, reason: String(process.env.REASON ?? '').trim() || 'Named products approved by approve-skus.ts.' } });
  console.log(`APPROVED ${changed.length} of ${ids.length}${changed.length < ids.length ? ' (a product with no stock recorded is not approved; set its stock in admin)' : ''}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
