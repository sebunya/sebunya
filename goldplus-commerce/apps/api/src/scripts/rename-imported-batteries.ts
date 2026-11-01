import '../config/env';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';

/**
 * The battery importer names a battery "<Brand> battery <code>" and the price
 * list carries no brand, so the 18-8-2026 import produced names like
 * "battery 30 RT". Give each one its honest name from the stock label it was
 * imported under ("GoldPlus Battery GP-IP-11-PRO-BATTERY"), through the
 * catalogue use case so the change is audited. Only placeholder names are
 * touched; anything an operator has already renamed is left alone.
 *
 *   ACTOR_USER_ID=<uuid> npx tsx src/scripts/rename-imported-batteries.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const r = Registry.getInstance();
  const ids = rowsOf(await db.execute(sql`select b.product_id as id, p.name from battery_profiles b join products p on p.id = b.product_id where p.name like 'battery %'`));
  let renamed = 0;
  for (const row of ids) {
    const productId = String(row.id);
    const aliases = await r.batteryCatalogueRepo.aliasesFor(productId);
    const label = aliases.map((a) => { const x = a as { alias?: string; aliasRaw?: string; aliasNormalised?: string }; return x.alias ?? x.aliasRaw ?? x.aliasNormalised ?? ''; }).filter(Boolean).sort((a, b) => b.length - a.length)[0];
    if (!label) continue;
    const clean = label.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
    const name = /battery/i.test(clean) ? `GoldPlus ${clean.replace(/\bBATTERY\b/i, 'Battery')}` : `GoldPlus Battery ${clean}`;
    await r.batteryCatalogueUseCases.update(productId, { name }, actorId);
    renamed += 1;
  }
  console.log(`renamed ${renamed} of ${ids.length}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
