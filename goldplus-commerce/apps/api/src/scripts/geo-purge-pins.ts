/**
 * Nightly: delete delivery pins past their purge date (the registry's
 * pin_retention_days, counted from capture) and expired pending locations.
 * A pin the customer saved to their address is theirs until they remove it
 * and is not touched here — EXCEPT a building picked from Google Places
 * (gps_source map_place): Google's terms allow its coordinates to be kept 30
 * days at most, so they go after 29 (this runs nightly), on orders and on
 * saved addresses alike. Its place ID stays (the terms allow that). Prints what
 * it deleted; never anything it kept.
 *
 * Usage: pnpm -F @goldplus/api geo:purge-pins
 */
import '../config/env';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { DeliveryConfigReader } from '../infrastructure/delivery/DeliveryConfigReader';
import { LOCATION_SIGNAL_RETENTION_DAYS } from '../domain/locations/LocationSignals';

/** Google-derived coordinates are removed after this many days; the nightly cadence keeps them under the terms' 30. */
export const MAP_PLACE_RETENTION_DAYS = 29;

export async function purgePins(now: Date = new Date()): Promise<{ signals: number; pins: number; pending: number; handovers: number; mapPlaceOrders: number; mapPlaceAddresses: number }> {
  const pins = (await db.execute(sql`delete from delivery_order_pin where purge_after < ${now} returning order_id`)) as unknown as { count?: number };
  const pending = (await db.execute(sql`delete from whatsapp_pending_location where expires_at < ${now} returning wamid`)) as unknown as { count?: number };
  // A rider's handover point is the customer's front door: same retention as a pin (privacy page). The attempt row stays.
  const retention = (await new DeliveryConfigReader().numericValues()).pin_retention_days;
  const days = Number.isFinite(retention) && retention >= 30 ? Math.min(retention, 365) : 180;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const handovers = (await db.execute(sql`
    update fulfilment_deliveries set handover_lat = null, handover_lng = null, handover_accuracy_m = null
    where handover_lat is not null and created_at < ${cutoff}`)) as unknown as { count?: number };
  const mapCutoff = new Date(now.getTime() - MAP_PLACE_RETENTION_DAYS * 86_400_000);
  const mapPlaceOrders = (await db.execute(sql`
    update orders set delivery_location = delivery_location - 'gpsLat' - 'gpsLng' - 'gpsAccuracyM'
    where delivery_location->>'gpsSource' = 'map_place' and delivery_location ? 'gpsLat' and created_at < ${mapCutoff}`)) as unknown as { count?: number };
  const mapPlaceAddresses = (await db.execute(sql`
    update addresses set gps_lat = null, gps_lng = null, gps_accuracy_m = null
    where gps_source = 'map_place' and gps_lat is not null and coalesce(gps_captured_at, updated_at) < ${mapCutoff}`)) as unknown as { count?: number };
  // 0193: location signals (areas, fees, ranks — no coordinates) are kept 13 months, then deleted.
  const signalCutoff = new Date(now.getTime() - LOCATION_SIGNAL_RETENTION_DAYS * 86_400_000);
  const signals = (await db.execute(sql`delete from location_signals where occurred_at < ${signalCutoff}`)) as unknown as { count?: number };
  return {
    signals: Number(signals?.count ?? 0),
    pins: Number(pins?.count ?? 0),
    pending: Number(pending?.count ?? 0),
    handovers: Number(handovers?.count ?? 0),
    mapPlaceOrders: Number(mapPlaceOrders?.count ?? 0),
    mapPlaceAddresses: Number(mapPlaceAddresses?.count ?? 0),
  };
}

if (require.main === module) {
  purgePins()
    .then((r) => {
      console.log(`PIN_PURGE_OK pins=${r.pins} pending=${r.pending} handover_points=${r.handovers} map_place_orders=${r.mapPlaceOrders} map_place_addresses=${r.mapPlaceAddresses} location_signals=${r.signals}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e?.stack ?? String(e));
      process.exit(1);
    });
}
