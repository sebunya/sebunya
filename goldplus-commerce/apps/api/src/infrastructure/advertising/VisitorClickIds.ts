import type { CanonicalTelemetryEvent } from '@goldplus/shared';
import { DrizzleIdentityRepository } from '../db/repositories/DrizzleIdentityRepository';
import { logger } from '../logging/logger';
import { metaBrowserIdFromVisitor } from '../../domain/advertising/MetaIdentifiers';

/**
 * Just-in-time click ids for browsing events (2026-10-01).
 *
 * A browser event (view_item, add_to_cart, begin_checkout, add_payment_info,
 * generate_lead) is accepted with nothing in user_data but the visitor id, the
 * IP and the user agent: the page may observe, but it may not name who the
 * visitor is or which ad they came from. The click id a visitor arrived with
 * (gclid, twclid, ttclid, …) is stitched separately by /telemetry/identity
 * into the identity graph — and, until this file, never read back. So every
 * ad platform that needs a click id to match (X above all: its default scope
 * is "visitors who arrived on an X click") received nothing for browsing
 * events, however many event ids were configured. Found 2026-10-01 against
 * production rows: 1,064 view_item, 464 add_to_cart, 227 begin_checkout, none
 * with a click id.
 *
 * The lookup happens at SEND time and the result is never queued or logged,
 * the same rule the order path follows (DeliveryService.loadIdentity). Only
 * click ids are merged here, for every platform; a signed-in customer's hashed
 * contact is added for Meta alone, by VisitorContact (owner decision). A click older than the networks' own windows is of no use
 * to them, so a click id that last changed more than 30 days ago is ignored.
 */
export const CLICK_ID_KEYS = ['gclid', 'wbraid', 'gbraid', 'fbc', 'fbp', 'ttclid', 'twclid', 'li_fat_id', 'epik'] as const;
export const CLICK_ID_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type VisitorClickRecord = Partial<Record<(typeof CLICK_ID_KEYS)[number], string | null>> & { updatedAt?: Date | string | null; clickIdsAt?: Date | string | null };
export type VisitorClickLookup = (fpClientId: string) => Promise<VisitorClickRecord | null>;

const defaultLookup: VisitorClickLookup = (fp) => new DrizzleIdentityRepository().getByFpClientId(fp);

/**
 * Meta's browser id for a shop with no Pixel: derived from the visitor id the
 * event already carries (MetaIdentifiers), so the same browser presents the
 * same id on every event without a second cookie or a stored value. Added
 * only when the event has none; only Meta's builder reads it.
 */
function withMetaBrowserId(event: CanonicalTelemetryEvent): CanonicalTelemetryEvent {
  const ud = (event.user_data ?? {}) as Record<string, unknown>;
  if (typeof ud.fbp === 'string' && ud.fbp) return event;
  const fbp = metaBrowserIdFromVisitor(ud.fp_client_id);
  return fbp ? ({ ...event, user_data: { ...ud, fbp } } as CanonicalTelemetryEvent) : event;
}

/** The event with the visitor's stitched click ids merged in; the same event when there is nothing to add. */
export async function withVisitorClickIds(event: CanonicalTelemetryEvent, lookup: VisitorClickLookup = defaultLookup, now: number = Date.now()): Promise<CanonicalTelemetryEvent> {
  return withMetaBrowserId(await withGraphClickIds(event, lookup, now));
}

async function withGraphClickIds(event: CanonicalTelemetryEvent, lookup: VisitorClickLookup, now: number): Promise<CanonicalTelemetryEvent> {
  const ud = (event.user_data ?? {}) as Record<string, unknown>;
  // An event that already names a click (the order path, or a test) is left exactly as it is.
  if (CLICK_ID_KEYS.some((k) => typeof ud[k] === 'string' && (ud[k] as string).length > 0)) return event;
  const fp = typeof ud.fp_client_id === 'string' ? ud.fp_client_id : '';
  if (!fp) return event;
  let rec: VisitorClickRecord | null;
  try { rec = await lookup(fp); } catch (err) {
    // A failed read must not stop the event: it goes as it was (and is skipped
    // by any platform that needs a click id), rather than waiting on the graph.
    logger.warn({ eventId: event.event_id, err: (err as Error).message }, '[Ads] visitor click-id lookup failed');
    return event;
  }
  if (!rec) return event;
  // When the click id last changed (0165); rows older than that column fall back to the row's last touch.
  const clickedAt = rec.clickIdsAt ?? rec.updatedAt;
  const touched = clickedAt ? new Date(clickedAt).getTime() : NaN;
  if (!Number.isFinite(touched) || now - touched > CLICK_ID_MAX_AGE_MS) return event;
  const clicks: Record<string, string> = {};
  for (const k of CLICK_ID_KEYS) { const v = rec[k]; if (typeof v === 'string' && v.length > 0) clicks[k] = v; }
  if (Object.keys(clicks).length === 0) return event;
  return { ...event, user_data: { ...ud, ...clicks } } as CanonicalTelemetryEvent;
}
