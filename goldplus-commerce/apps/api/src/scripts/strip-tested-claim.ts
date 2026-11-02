import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { UpdateProductListingUseCase } from '../application/use-cases/products/UpdateProductListingUseCase';
import { TESTED_CLAIM, stripClaim } from '../domain/products/TestedClaimWording';
import { actorUserId, rowsOf } from './lib/scriptHelpers';

/**
 * Removes the "tested before sale" promise from every product's short and
 * long description. The owner decided on 2026-10-13 that the shop does not
 * make this claim; the FAQ (OPS-01), the site banner, llms.txt, the agent
 * documents and the shop metadata were changed in the same PR, and the data
 * files that seeded the descriptions were edited so a rerun cannot bring the
 * sentence back. Nothing else in a description is touched; the sentence is
 * removed in place and the delivery promise that followed it is kept.
 *
 * Dry run by default (prints what would change). APPLY=1 writes, audited as
 * one PRODUCT_DESCRIPTIONS_EDITED batch.
 *
 *   ACTOR_USER_ID=<uuid> [APPLY=1] npx tsx src/scripts/strip-tested-claim.ts
 */

async function main(): Promise<void> {
  const apply = process.env.APPLY === '1';
  const actorId = actorUserId(apply);
  const rows = rowsOf(await db.execute(sql`
    select id, sku, short_description, long_description from products
    where short_description ~* 'tested before|unit is tested' or long_description ~* 'tested before|unit is tested'
    order by sku`));
  const changes: Array<{ id: string; sku: string; short?: [string, string]; long?: [string, string] }> = [];
  for (const r of rows) {
    const s0 = String(r.short_description ?? ''); const l0 = String(r.long_description ?? '');
    const s1 = stripClaim(s0); const l1 = stripClaim(l0);
    if (s1 === s0 && l1 === l0) continue;
    changes.push({ id: String(r.id), sku: String(r.sku), ...(s1 !== s0 ? { short: [s0, s1] } : {}), ...(l1 !== l0 ? { long: [l0, l1] } : {}) });
  }
  console.log(`${rows.length} products still carry the claim; ${changes.length} would change${apply ? '' : ' (dry run; set APPLY=1 to write)'}`);
  for (const c of changes.slice(0, 5)) console.log(`  ${c.sku}: ${c.short ? `short → "${c.short[1]}"` : ''} ${c.long ? `long → "${c.long[1].slice(0, 120)}…"` : ''}`);
  const leftover = rows.filter((r) => TESTED_CLAIM.test(stripClaim(String(r.short_description ?? '')) + ' ' + stripClaim(String(r.long_description ?? ''))));
  if (leftover.length) console.log(`WARNING: ${leftover.length} products keep a phrasing the rules do not know: ${leftover.map((r) => r.sku).join(', ')}`);
  if (!apply) return;
  const registry = Registry.getInstance();
  const listing = new UpdateProductListingUseCase(registry.productRepo, registry.attributeRepo);
  const done: string[] = [];
  for (const c of changes) {
    // The listing use case: same validation (length limits) and write path as the admin editor; no specs sent, so specs stay.
    const result = await listing.execute({ productId: c.id, ...(c.short ? { shortDescription: c.short[1] } : {}), ...(c.long ? { longDescription: c.long[1] } : {}) });
    if (!result.ok) { console.log(`  FAILED ${c.sku}: ${result.message}`); continue; }
    done.push(c.id);
  }
  if (done.length) await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId, action: 'PRODUCT_DESCRIPTIONS_EDITED', entity: 'product_bulk_edit', entityId: randomUUID(),
    newState: { reason: 'owner decision 2026-10-13: the shop does not claim every unit is tested before sale', count: done.length, productIds: done },
  });
  console.log(`descriptions rewritten for ${done.length} of ${changes.length} products`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
