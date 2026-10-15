/**
 * Nightly: delete delivery pins past their purge date (the registry's
 * pin_retention_days, counted from capture) and expired pending locations.
 * A pin the customer saved to their address is theirs until they remove it
 * and is not touched here. Prints what it deleted; never anything it kept.
 *
 * Usage: pnpm -F @goldplus/api geo:purge-pins
 */
import '../config/env';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';

export async function purgePins(now: Date = new Date()): Promise<{ pins: number; pending: number }> {
  const pins = (await db.execute(sql`delete from delivery_order_pin where purge_after < ${now} returning order_id`)) as unknown as { count?: number };
  const pending = (await db.execute(sql`delete from whatsapp_pending_location where expires_at < ${now} returning wamid`)) as unknown as { count?: number };
  return { pins: Number(pins?.count ?? 0), pending: Number(pending?.count ?? 0) };
}

if (require.main === module) {
  purgePins()
    .then((r) => {
      console.log(`PIN_PURGE_OK pins=${r.pins} pending=${r.pending}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e?.stack ?? String(e));
      process.exit(1);
    });
}
