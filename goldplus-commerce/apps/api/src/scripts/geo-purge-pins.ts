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
import { DeliveryConfigReader } from '../infrastructure/delivery/DeliveryConfigReader';

export async function purgePins(now: Date = new Date()): Promise<{ pins: number; pending: number; handovers: number }> {
  const pins = (await db.execute(sql`delete from delivery_order_pin where purge_after < ${now} returning order_id`)) as unknown as { count?: number };
  const pending = (await db.execute(sql`delete from whatsapp_pending_location where expires_at < ${now} returning wamid`)) as unknown as { count?: number };
  // A rider's handover point is the customer's front door: same retention as a pin (privacy page). The attempt row stays.
  const retention = (await new DeliveryConfigReader().numericValues()).pin_retention_days;
  const days = Number.isFinite(retention) && retention >= 30 ? Math.min(retention, 365) : 180;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const handovers = (await db.execute(sql`
    update fulfilment_deliveries set handover_lat = null, handover_lng = null, handover_accuracy_m = null
    where handover_lat is not null and created_at < ${cutoff}`)) as unknown as { count?: number };
  return { pins: Number(pins?.count ?? 0), pending: Number(pending?.count ?? 0), handovers: Number(handovers?.count ?? 0) };
}

if (require.main === module) {
  purgePins()
    .then((r) => {
      console.log(`PIN_PURGE_OK pins=${r.pins} pending=${r.pending} handover_points=${r.handovers}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e?.stack ?? String(e));
      process.exit(1);
    });
}
