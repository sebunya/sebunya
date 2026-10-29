import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

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
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

/** Ordered: longer phrasings first so the short catch-alls only see what is left. */
const RULES: Array<[RegExp, string]> = [
  [/ Every unit is tested before it is sold, with same-day delivery in Kampala and Wakiso\./g, ' Same-day delivery in Kampala and Wakiso.'],
  [/ Every unit is tested before it is sold; same-day delivery in Kampala and Wakiso\./g, ' Same-day delivery in Kampala and Wakiso.'],
  [/ Every unit (?:is )?tested before it is sold\.? Same-day delivery/g, ' Same-day delivery'],
  [/ Tested before sale; fit confirmed before you pay\./g, ' Not sure it fits? Ask us and we confirm it before you order.'], // 2026-10-29: never the bare promise
  [/ Tested before sale\. Same-day/g, ' Same-day'],
  [/ Tested before sale\.?$/g, ''],
  [/ Every unit (?:is )?tested before it is sold\.?/g, ''],
  [/ Tested before sale\.?/g, ''],
];
export function stripClaim(text: string): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out.replace(/\s{2,}/g, ' ').trim();
}

async function main(): Promise<void> {
  const apply = process.env.APPLY === '1';
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (apply && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
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
  const leftover = rows.filter((r) => /tested before|unit is tested/i.test(stripClaim(String(r.short_description ?? '')) + ' ' + stripClaim(String(r.long_description ?? ''))));
  if (leftover.length) console.log(`WARNING: ${leftover.length} products keep a phrasing the rules do not know: ${leftover.map((r) => r.sku).join(', ')}`);
  if (!apply) return;
  for (const c of changes) {
    await db.execute(sql`update products set
      short_description = ${c.short ? c.short[1] : sql`short_description`},
      long_description = ${c.long ? c.long[1] : sql`long_description`},
      updated_at = now() where id = ${c.id}`);
  }
  await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({
    actorId, action: 'PRODUCT_DESCRIPTIONS_EDITED', entity: 'product_bulk_edit', entityId: randomUUID(),
    newState: { reason: 'owner decision 2026-10-13: the shop does not claim every unit is tested before sale', count: changes.length, productIds: changes.map((c) => c.id) },
  });
  console.log(`descriptions rewritten for ${changes.length} products`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
