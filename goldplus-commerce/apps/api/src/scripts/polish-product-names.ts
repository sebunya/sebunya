import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

/**
 * Names were built as "GoldPlus <Category> <price-list code>". The price
 * list's codes carry their own category suffix (PB = power bank, MC = memory
 * card, F = flash drive, CH = charger, BT = Bluetooth), so a customer read
 * "GoldPlus Power Bank GP-P07 PB". Drop the suffix the category word already
 * says, and write "TYPE C" the way people do. The model number keeps the
 * price list's exact text; only the display name changes. Audited as a batch.
 *
 *   ACTOR_USER_ID=<uuid> npx tsx src/scripts/polish-product-names.ts
 */
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));
function polish(name: string): string {
  let n = name;
  n = n.replace(/^(GoldPlus Power Bank .*?)\s+PB$/, '$1').replace(/^(GoldPlus Memory Card .*?)\s+MC$/, '$1').replace(/^(GoldPlus Flash Drive .*?)\s+F$/, '$1')
       .replace(/^(GoldPlus Charger .*?)\s+CH$/, '$1').replace(/^(GoldPlus Bluetooth .*?)\s+BT$/, '$1');
  n = n.replace(/\bTYPE C\b/, 'Type-C').replace(/\bTYPE PIN\b/, 'Pin').replace(/\bUNIVERSAL CH\b/, 'Universal').replace(/\bC TO C\b/, 'Type-C to Type-C').replace(/\bC TO IPHONE\b/, 'Type-C to iPhone');
  return n.replace(/\s+/g, ' ').trim();
}
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const rows = rowsOf(await db.execute(sql`select id, name from products where name like 'GoldPlus %'`));
  const changes: Array<{ id: string; from: string; to: string }> = [];
  for (const r of rows) { const to = polish(String(r.name)); if (to !== r.name) changes.push({ id: String(r.id), from: String(r.name), to }); }
  for (const c of changes) await db.execute(sql`update products set name = ${c.to}, updated_at = now() where id = ${c.id} and name = ${c.from}`);
  if (changes.length) await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({ actorId, action: 'PRODUCT_NAMES_POLISHED', entity: 'product_bulk_edit', entityId: randomUUID(), newState: { count: changes.length, changes } });
  console.log(`renamed ${changes.length}`); for (const c of changes.slice(0, 6)) console.log(`  ${c.from} → ${c.to}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
