import '../config/env';
import { sql } from 'drizzle-orm';
import { db, endDbConnection } from '../infrastructure/db/client';

/**
 * Model numbers came off the price list as "GP - C10" while the SKU is
 * "GP-C10". The model number is what the Merchant feed sends as g:mpn and what
 * the product page prints, and an identifier with stray spaces is a different
 * identifier to Google. Collapse whitespace around hyphens in model_number and
 * in the generated short description that quotes it ("model GP - C10").
 * Formatting only: no character other than whitespace changes.
 *
 *   DRY_RUN=1 npx tsx src/scripts/normalize-model-numbers.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const rows = rowsOf(await db.execute(sql`select id, sku, model_number, short_description from products where model_number ~ '\\s-|-\\s' or short_description ~ 'model [A-Za-z0-9]+ - '`));
  console.log(`${rows.length} products carry a spaced hyphen in model_number or its description`);
  for (const r of rows) {
    const model = String(r.model_number ?? '').replace(/\s*-\s*/g, '-').trim();
    const desc = String(r.short_description ?? '').replace(/model ([A-Za-z0-9]+(?:\s*-\s*[A-Za-z0-9]+)+)/g, (_m, code: string) => `model ${code.replace(/\s*-\s*/g, '-')}`);
    console.log(`  ${r.sku}: "${r.model_number}" → "${model}"${desc !== r.short_description ? ' (+description)' : ''}`);
    if (dryRun) continue;
    await db.execute(sql`update products set model_number = ${model}, short_description = ${desc}, updated_at = now() where id = ${String(r.id)}`);
  }
  console.log(dryRun ? 'DRY RUN — nothing changed.' : `normalised ${rows.length}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
