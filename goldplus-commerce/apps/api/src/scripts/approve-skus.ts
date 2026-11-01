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
 * Order for a photo batch: attach-images-by-code → demo-gallery-frames MODE=remove → approve-skus. A product with no real
 * photo (none, or only "Sample " frames) is never approved: the owner's rule (2026-10-12) is no live product without one.
 * Dry run by default.   ONLY=SKU1,SKU2 [APPLY=1] ACTOR_USER_ID=<uuid> npx tsx src/scripts/approve-skus.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));
async function main(): Promise<void> {
  const only = parseOnly(process.env.ONLY);
  if (only.size === 0 || only.size > MAX_ONLY_SKUS) throw new Error(`ONLY must list between 1 and ${MAX_ONLY_SKUS} SKUs.`);
  const apply = process.env.APPLY === '1';
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (apply && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('APPLY=1 needs ACTOR_USER_ID.');
  const listed = rowsOf(await db.execute(sql`
    select p.id, p.sku, p.approval_status, p.active, p.stock_quantity,
           count(i.id) filter (where i.alt_text is null or i.alt_text not like 'Sample %')::int as real_images
      from products p left join product_images i on i.product_id = p.id
     group by p.id order by p.sku`)).filter((r) => only.has(String(r.sku).toUpperCase()));
  for (const r of listed) console.log(`  ${r.sku}: ${r.approval_status}, ${r.active ? 'on sale' : 'off sale'}, stock ${r.stock_quantity}, ${r.real_images} real photo(s)`);
  // Same rule as draft-products-without-photos.ts: no real photo, no sale (attach the photos first).
  const photoless = listed.filter((r) => Number(r.real_images) === 0);
  if (photoless.length) console.log(`  no real photo, not approved: ${photoless.map((r) => r.sku).join(', ')}`);
  const rows = listed.filter((r) => Number(r.real_images) > 0);
  const missing = [...only].filter((s) => !listed.some((r) => String(r.sku).toUpperCase() === s));
  if (missing.length) console.log(`  not found: ${missing.join(', ')}`);
  if (!apply) { console.log(`DRY RUN: would approve ${rows.length} product(s). Nothing changed.`); return; }
  const r = Registry.getInstance();
  const ids = rows.map((x) => String(x.id));
  const changed = await r.productRepo.setApprovalMany(ids, 'approved', true, { requireStock: true });
  await new CreateAuditLogUseCase(r.auditRepo).execute({ actorId, action: 'PRODUCTS_BULK_APPROVAL', entity: 'product_bulk_approval', entityId: randomUUID(), previousState: { approvalStatus: 'draft', active: false }, newState: { approvalStatus: 'approved', active: true, requireStock: true, requested: ids.length, changed: changed.length, productIds: changed, reason: String(process.env.REASON ?? '').trim() || 'Named products approved by approve-skus.ts.' } });
  console.log(`APPROVED ${changed.length} of ${ids.length}${changed.length < ids.length ? ' (a product with no stock recorded is not approved; set its stock in admin)' : ''}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
