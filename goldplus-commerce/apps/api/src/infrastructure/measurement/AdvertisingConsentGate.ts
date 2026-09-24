import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * D-002: advertising sinks honour an explicit, stored advertising refusal,
 * re-checked right before each send. ONE predicate for both ad paths: the
 * purchase deliveries (DeliveryService) and the browsing conversions
 * (AdConversionDispatch), which used to check nothing, so a shopper who
 * switched advertising off still had every product view and add-to-cart sent
 * to Meta and TikTok with their IP and user agent.
 *
 * No expiry clause: a refusal stays a refusal until the customer changes it.
 * Every stored choice carried a 180-day expiry, and the gate used to treat an
 * expired refusal as no refusal, so sends resumed without the customer doing
 * anything. ("No row" stays "allowed", per D-002.)
 */
export function isStoredAdvertisingRefusal(row: { advertising_granted?: unknown; last_grant_type?: unknown } | null | undefined): boolean {
  return !!row && row.advertising_granted === false && row.last_grant_type !== 'unknown';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

/**
 * True when the person (by user id) or the browser (by first-party id) has an
 * explicit advertising refusal on record. THROWS when the lookup fails: the
 * caller must defer, never send on an unknown answer.
 */
export async function advertisingRefused(who: { userId?: string | null; fpClientId?: string | null }): Promise<boolean> {
  const userId = who.userId && UUID.test(who.userId) ? who.userId : null;
  const fpClientId = who.fpClientId || null;
  if (!userId && !fpClientId) return false;
  const found = rows(await db.execute(sql`select advertising_granted, last_grant_type from consent_current_state
    where (${userId}::uuid is not null and user_id = ${userId}::uuid) or (${fpClientId}::text is not null and fp_client_id = ${fpClientId}::text)`));
  return found.some(isStoredAdvertisingRefusal);
}
