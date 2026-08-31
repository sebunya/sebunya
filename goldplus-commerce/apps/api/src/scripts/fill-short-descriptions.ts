import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

/**
 * A factual one-line description for every product that has none: what it
 * is, its model as the price list writes it, and the two promises the shop
 * already makes everywhere else (tested before sale; same-day delivery in
 * Kampala and Wakiso). Nothing about the product is invented; anything an
 * operator has already written is left alone. Audited as one batch.
 *
 *   ACTOR_USER_ID=<uuid> npx tsx src/scripts/fill-short-descriptions.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));
const KIND: Array<[RegExp, string]> = [
  [/battery/i, 'replacement battery'], [/power bank/i, 'power bank'], [/car charger/i, 'car charger'], [/charger/i, 'charger'], [/cable/i, 'cable'],
  [/earphone/i, 'earphones'], [/bluetooth/i, 'Bluetooth audio device'], [/memory card/i, 'memory card'], [/flash drive/i, 'flash drive'],
  [/card reader/i, 'card reader'], [/mouse/i, 'computer mouse'], [/sound card/i, 'USB sound card'],
];
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const rows = rowsOf(await db.execute(sql`select id, name, model_number from products where length(btrim(short_description)) = 0`));
  const done: string[] = [];
  for (const r of rows) {
    const name = String(r.name); const model = String(r.model_number ?? '').trim();
    const kind = KIND.find(([re]) => re.test(name))?.[1] ?? 'accessory';
    const text = `GoldPlus ${kind}${model ? `, model ${model}` : ''}. Every unit is tested before it is sold. Same-day delivery in Kampala and Wakiso.`;
    await db.execute(sql`update products set short_description = ${text}, updated_at = now() where id = ${String(r.id)} and length(btrim(short_description)) = 0`);
    done.push(String(r.id));
  }
  await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({ actorId, action: 'PRODUCT_DESCRIPTIONS_FILLED', entity: 'product_bulk_edit', entityId: randomUUID(), newState: { count: done.length, productIds: done, template: 'GoldPlus <kind>, model <model>. Every unit is tested before it is sold. Same-day delivery in Kampala and Wakiso.' } });
  console.log(`descriptions written for ${done.length} products`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
