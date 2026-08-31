import '../config/env';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';

/**
 * The battery importer carries the selling price (Price D) but not the tiers,
 * so imported batteries have no floor — which the engine treats as "not
 * discountable". Give each its Price A floor and preserved B/C from the price
 * list, matched by the name the import gave it, through the product
 * repository so the database CHECK (floor ≤ retail) still guards every write.
 *
 *   ROWS_FILE=/import/battery-tiers.json npx tsx src/scripts/set-battery-price-tiers.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

async function main(): Promise<void> {
  const rows = JSON.parse(readFileSync(String(process.env.ROWS_FILE ?? '/import/battery-tiers.json'), 'utf8')) as Array<{ name: string; floor_A: number; tier_B: number; tier_C: number; retail_D: number }>;
  const repo = Registry.getInstance().productRepo;
  let set = 0, missing = 0, skipped = 0;
  for (const r of rows) {
    const found = rowsOf(await db.execute(sql`select p.id, p.price_ugx from products p join battery_profiles b on b.product_id = p.id where p.name = ${r.name} limit 1`))[0];
    if (!found) { missing += 1; console.log('  no battery named', r.name); continue; }
    const retail = Number(found.price_ugx);
    if (!(retail > 0) || r.floor_A > retail) { skipped += 1; console.log(`  skip ${r.name}: retail ${retail}, floor ${r.floor_A}`); continue; }
    await repo.setPriceTiers(String(found.id), { floorPriceUgx: r.floor_A, tierBPriceUgx: r.tier_B, tierCPriceUgx: r.tier_C });
    set += 1;
  }
  console.log(`floors set ${set}, missing ${missing}, skipped ${skipped}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
