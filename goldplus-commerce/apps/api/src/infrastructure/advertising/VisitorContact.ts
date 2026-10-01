import { sql } from 'drizzle-orm';
import type { CanonicalTelemetryEvent } from '@goldplus/shared';
import { db } from '../db/client';
import { hashEmail, hashPhone } from './AdPlatforms';

/**
 * The signed-in customer behind a browsing event, for Meta (owner decision,
 * 2026-10-01: "Yes, send them").
 *
 * A browser event names only its visitor: a page may not say who the visitor
 * is. When that visitor has signed in on this browser, the identity graph
 * links the visitor id to the account, and the account's email and phone are
 * what Meta matches best on. They are read HERE, at send time, hashed as Meta
 * specifies, and never stored on the queued row or logged — the same rule as
 * the click ids (VisitorClickIds).
 *
 * Meta only: no other platform's events are given a contact this way. The
 * account's own advertising choice is checked by the caller with the user id
 * returned here, because a browsing event carries no user id for the consent
 * gate to see.
 */
export type VisitorAccount = { userId: string; email: string | null; phone: string | null };
export type VisitorAccountLookup = (fpClientId: string) => Promise<VisitorAccount | null>;

const defaultLookup: VisitorAccountLookup = async (fp) => {
  const res = await db.execute(sql`select u.id, u.email, u.phone from first_party_identities fi join users u on u.id = fi.user_id
    where fi.fp_client_id = ${fp} and fi.user_id is not null order by fi.updated_at desc limit 1`);
  const r = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? [])[0] as { id?: unknown; email?: unknown; phone?: unknown } | undefined;
  return r?.id ? { userId: String(r.id), email: typeof r.email === 'string' ? r.email : null, phone: typeof r.phone === 'string' ? r.phone : null } : null;
};

/** The account this event's visitor is signed in to on this browser, or null. An event that already names a contact (an order's purchase) is not looked up. */
export async function visitorAccount(event: CanonicalTelemetryEvent, lookup: VisitorAccountLookup = defaultLookup): Promise<VisitorAccount | null> {
  const ud = (event.user_data ?? {}) as Record<string, unknown>;
  if (ud.hashed_email || ud.hashed_phone) return null;
  const fp = typeof ud.fp_client_id === 'string' ? ud.fp_client_id : '';
  return fp ? lookup(fp) : null;
}

/** The event with the account's hashed email and phone added; the same event when the account has neither. */
export function withAccountContact(event: CanonicalTelemetryEvent, account: VisitorAccount | null): CanonicalTelemetryEvent {
  if (!account) return event;
  const hashed_email = hashEmail(account.email), hashed_phone = hashPhone(account.phone);
  if (!hashed_email && !hashed_phone) return event;
  const ud = (event.user_data ?? {}) as Record<string, unknown>;
  return { ...event, user_data: { ...ud, ...(hashed_email ? { hashed_email } : {}), ...(hashed_phone ? { hashed_phone } : {}) } } as CanonicalTelemetryEvent;
}
