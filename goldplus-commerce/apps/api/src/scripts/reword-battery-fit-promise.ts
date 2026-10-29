import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { UNCONDITIONAL_FIT_PROMISE, rewordFitPromise } from '../domain/batteries/BatteryFitWording';

/**
 * Rewords the battery listings' unconditional "Fit confirmed before you pay." (2026-10-29 review of the guides). The
 * shop checks a fit when the customer asks, with their phone or the code on their old battery; it does not confirm
 * every order's fit before payment, and since 2026-10-28 (0211) a fit from the supplier's compatibility list is shown
 * as a fit, labelled as such. The pages, Goldie and the guides were changed on 2026-10-28/29; these descriptions came
 * from catalogue-copy-2026-09.json, edited in the same commit so a rerun cannot bring the sentence back.
 *
 * Only the two unconditional short sentences change. The long descriptions' "bring your phone or the code ... and we
 * confirm the fit" and "send us your phone model ... and we confirm the fit" are offers the customer takes up, and stay.
 *
 * Dry run by default (prints what would change). APPLY=1 writes, audited as one PRODUCT_DESCRIPTIONS_EDITED batch.
 *
 *   ACTOR_USER_ID=<uuid> [APPLY=1] npx tsx src/scripts/reword-battery-fit-promise.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));


async function main(): Promise<void> {
  const apply = process.env.APPLY === '1';
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (apply && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const rows = rowsOf(await db.execute(sql`
    select id, sku, short_description, long_description from products
    where short_description ~* 'confirm(ed)? (the fit )?before you pay' or long_description ~* 'fit confirmed before you pay'
    order by sku`));
  const changes: Array<{ id: string; sku: string; short?: [string, string]; long?: [string, string] }> = [];
  for (const r of rows) {
    const s0 = String(r.short_description ?? ''); const l0 = String(r.long_description ?? '');
    const s1 = rewordFitPromise(s0); const l1 = rewordFitPromise(l0);
    if (s1 === s0 && l1 === l0) continue;
    changes.push({ id: String(r.id), sku: String(r.sku), ...(s1 !== s0 ? { short: [s0, s1] } : {}), ...(l1 !== l0 ? { long: [l0, l1] } : {}) });
  }
  console.log(`${rows.length} products carry a fit promise; ${changes.length} would change${apply ? '' : ' (dry run; set APPLY=1 to write)'}`);
  for (const c of changes.slice(0, 5)) console.log(`  ${c.sku}: ${c.short ? `short → "${c.short[1]}"` : ''} ${c.long ? `long → "${c.long[1].slice(0, 120)}…"` : ''}`);
  const leftover = rows.filter((r) => UNCONDITIONAL_FIT_PROMISE.test(`${rewordFitPromise(String(r.short_description ?? ''))} ${rewordFitPromise(String(r.long_description ?? ''))}`));
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
    newState: { reason: 'review 2026-10-29: a battery fit is confirmed when the customer asks, not before every payment', count: changes.length, productIds: changes.map((c) => c.id) },
  });
  console.log(`descriptions reworded for ${changes.length} products`);
}

main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
