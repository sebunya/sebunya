import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

/**
 * Takes every live product that has no real photograph off the storefront by
 * setting it back to draft (owner request, 2026-10-12). "No real photograph"
 * means every gallery image is a placeholder (alt text starting "Sample ",
 * written by demo-gallery-frames.ts) or the gallery is empty. The change goes
 * through the same repository method as the admin bulk-approval button and is
 * audited as PRODUCTS_BULK_APPROVAL, so it can be reviewed and reversed from
 * the admin (approve the same ids again once photos exist).
 *
 * Dry run (default) prints the list and changes nothing:
 *   npx tsx src/scripts/draft-products-without-photos.ts
 * Apply:
 *   ACTOR_USER_ID=<admin uuid> APPLY=1 npx tsx src/scripts/draft-products-without-photos.ts
 * Optional: ONLY=SKU1,SKU2 limits to those SKUs; KEEP=SKU3 excludes.
 */
interface Row { id: string; sku: string; name: string; stock_quantity: number; real_images: number; sample_images: number }

async function main(): Promise<void> {
  const apply = process.env.APPLY === '1';
  const only = new Set(String(process.env.ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const keep = new Set(String(process.env.KEEP ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (apply && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('APPLY=1 needs ACTOR_USER_ID=<acting admin uuid>.');

  const res = await db.execute(sql`
    SELECT p.id, p.sku, p.name, p.stock_quantity,
      COUNT(i.id) FILTER (WHERE i.alt_text IS NULL OR i.alt_text NOT LIKE 'Sample %')::int AS real_images,
      COUNT(i.id) FILTER (WHERE i.alt_text LIKE 'Sample %')::int AS sample_images
    FROM products p
    LEFT JOIN product_images i ON i.product_id = p.id
    WHERE p.approval_status = 'approved' AND p.active = true
    GROUP BY p.id, p.sku, p.name, p.stock_quantity
    HAVING COUNT(i.id) FILTER (WHERE i.alt_text IS NULL OR i.alt_text NOT LIKE 'Sample %') = 0
    ORDER BY p.sku`);
  const rows = ((Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows) ?? []) as unknown as Row[];
  const chosen = rows.filter((r) => (only.size === 0 || only.has(r.sku)) && !keep.has(r.sku));

  console.log(`${rows.length} live product(s) have no real photograph${only.size || keep.size ? `; ${chosen.length} selected` : ''}:`);
  for (const r of chosen) console.log(`  ${r.sku.padEnd(22)} ${r.sample_images} sample frame(s), stock ${r.stock_quantity}  ${r.name}`);
  if (!apply) { console.log('\nDry run: nothing changed. Re-run with APPLY=1 and ACTOR_USER_ID to set these to draft.'); return; }
  if (chosen.length === 0) { console.log('Nothing to do.'); return; }

  const r = Registry.getInstance();
  const ids = chosen.map((c) => c.id);
  // draft + inactive: off the storefront, the sitemap and the feeds; stock, price and images untouched.
  const changed = await r.productRepo.setApprovalMany(ids, 'draft', false);
  const batchId = randomUUID();
  await new CreateAuditLogUseCase(r.auditRepo).execute({
    actorId, action: 'PRODUCTS_BULK_APPROVAL', entity: 'product_bulk_approval', entityId: batchId,
    newState: { approvalStatus: 'draft', active: false, requireStock: false, reason: 'no real photograph (draft-products-without-photos.ts)', requested: ids.length, changed: changed.length, skipped: ids.length - changed.length, productIds: changed },
  });
  console.log(`\nSet to draft: ${changed.length} of ${ids.length} (audit batch ${batchId}). To reverse: admin products → select these ids → approve.`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => endDbConnection());
