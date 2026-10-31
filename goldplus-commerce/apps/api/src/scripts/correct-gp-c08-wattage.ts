import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { GP_C08_SKU, rewriteTwelveWatts, rewriteTwelveWattsDeep } from '../domain/products/ChargerWattageCorrection';

/**
 * Corrects GP-C08 from 12W to 10W (2026-10-29): its listed outputs, 5V⎓2A and 9V⎓1A, give at most 10W. The seed
 * files (supplier-specs-2026-09.json, seo-metadata-review-2026-10-12.json) were edited in the same commit so a
 * rerun cannot bring 12W back. The slug stays, so links keep working.
 *
 * Dry run by default (prints what would change). APPLY=1 writes, audited as PRODUCT_SPEC_CORRECTED.
 *
 *   ACTOR_USER_ID=<uuid> [APPLY=1] npx tsx src/scripts/correct-gp-c08-wattage.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

async function main(): Promise<void> {
  const apply = process.env.APPLY === '1';
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (apply && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const [row] = rowsOf(await db.execute(sql`
    select id, name, short_description, long_description, features, specifications from products where sku = ${GP_C08_SKU}`));
  if (!row) { console.log(`${GP_C08_SKU} not found; nothing to do`); return; }
  const before = { name: String(row.name), short: String(row.short_description ?? ''), long: String(row.long_description ?? ''), features: row.features, specs: row.specifications };
  const after = {
    name: rewriteTwelveWatts(before.name), short: rewriteTwelveWatts(before.short), long: rewriteTwelveWatts(before.long),
    features: rewriteTwelveWattsDeep(before.features), specs: rewriteTwelveWattsDeep(before.specs),
  };
  const changed: string[] = (Object.keys(before) as Array<keyof typeof before>).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  // The PDP's "Output power" row is a typed attribute value (product_attribute_values), not the specifications jsonb.
  const attrs = rowsOf(await db.execute(sql`
    select v.attribute_id from product_attribute_values v join attributes a on a.id = v.attribute_id
    where v.product_id = ${String(row.id)} and a.name ~* '^\\s*output power\\s*$' and v.value ~ '^\\s*12\\s*(W)?\\s*$'`));
  if (attrs.length) changed.push('output power attribute');
  console.log(`${GP_C08_SKU}: ${changed.length ? `would change ${changed.join(', ')}` : 'already says 10W'}${apply ? '' : ' (dry run; set APPLY=1 to write)'}`);
  console.log(`  name → "${after.name}"`);
  if (/\b12 ?W\b/.test(JSON.stringify(after))) console.log('WARNING: a 12W the rules do not know is left');
  if (!apply || !changed.length) return;
  await db.execute(sql`update products set
    name = ${after.name}, short_description = ${after.short}, long_description = ${after.long},
    features = ${JSON.stringify(after.features)}::jsonb, specifications = ${JSON.stringify(after.specs)}::jsonb,
    updated_at = now() where id = ${String(row.id)}`);
  for (const a of attrs) {
    await db.execute(sql`update product_attribute_values set value = '10', updated_at = now()
      where product_id = ${String(row.id)} and attribute_id = ${String(a.attribute_id)}`);
  }
  await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({
    actorId, action: 'PRODUCT_SPEC_CORRECTED', entity: 'product', entityId: String(row.id),
    previousState: { name: before.name, specifications: before.specs },
    newState: { reason: 'outputs 5V⎓2A and 9V⎓1A give at most 10W, not 12W', name: after.name, specifications: after.specs, fields: changed, batch: randomUUID() },
  });
  console.log(`${GP_C08_SKU} corrected to 10W (${changed.join(', ')})`);
}

main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
