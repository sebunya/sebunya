import '../config/env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { UpdateProductListingUseCase } from '../application/use-cases/products/UpdateProductListingUseCase';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

/**
 * Applies the maker's specifications transcribed from the supplier photo
 * panels (data/supplier-specs-2026-09.json) to the products they belong to:
 * a spec-bearing title, a factual long description, and verified attribute
 * values — through the SAME use case the admin listing editor uses, audited
 * per product. Idempotent: re-running writes the same values.
 *
 *   ACTOR_USER_ID=<uuid> DRY_RUN=1 npx tsx src/scripts/apply-supplier-specs.ts
 */
interface SpecFile { products: Array<{ sku: string; title: string; longDescription: string; specs: Array<{ name: string; value: string; unit?: string }> }> }
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const dryRun = process.env.DRY_RUN === '1';
  const data = JSON.parse(readFileSync(join(__dirname, 'data', 'supplier-specs-2026-09.json'), 'utf8')) as SpecFile;
  const registry = Registry.getInstance();
  const uc = new UpdateProductListingUseCase(registry.productRepo, registry.attributeRepo);
  const audit = new CreateAuditLogUseCase(registry.auditRepo);

  let applied = 0, missing = 0;
  for (const entry of data.products) {
    const row = rowsOf(await db.execute(sql`select id, name from products where upper(sku) = ${entry.sku.toUpperCase()}`))[0];
    if (!row) { missing += 1; console.log(`  MISSING ${entry.sku} — no product with this sku`); continue; }
    console.log(`  ${entry.sku}: "${row.name}" → "${entry.title}" (+${entry.specs.length} verified specs, long description)`);
    if (dryRun) continue;
    const result = await uc.execute({
      productId: String(row.id), name: entry.title, longDescription: entry.longDescription,
      specs: entry.specs.map((s) => ({ ...s, isVerified: true })),
    });
    if (!result.ok) { console.log(`    FAILED: ${result.message}`); continue; }
    await audit.execute({ actorId, action: 'PRODUCT_LISTING_UPDATED', entity: 'product', entityId: String(row.id), newState: { ...result.changed, source: 'supplier-specs-2026-09' } });
    applied += 1;
  }
  console.log(`${data.products.length} entries: applied ${applied}, missing ${missing}${dryRun ? ' (DRY RUN — nothing written)' : ''}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
