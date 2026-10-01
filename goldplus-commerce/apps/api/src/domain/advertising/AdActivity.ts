/**
 * What actually happened to each event bound for an ad platform (2026-10-01).
 *
 * The advertising page shows what is CONFIGURED. It could not answer the
 * owner's question after switching X on: "is anything arriving, and if not,
 * where does it stop?" This module turns the two delivery records — the
 * browsing-event queue and the order-path intents — into one vocabulary of
 * four outcomes and a sentence a person can act on.
 *
 * Pure: no database, no HTTP. Every sentence is derived from a stored state
 * and its stored reason; nothing is guessed, and an unknown reason is shown
 * as it was recorded rather than dressed up.
 */
export type AdOutcome = 'sent' | 'not_sent' | 'failed' | 'waiting';
export const AD_OUTCOMES: readonly AdOutcome[] = ['sent', 'not_sent', 'failed', 'waiting'];

export const ACTIVITY_WINDOWS = [7, 30, 90] as const;
export const activityWindow = (raw: unknown): number => {
  const n = Number(raw);
  return (ACTIVITY_WINDOWS as readonly number[]).includes(n) ? n : 30;
};

/**
 * How a visitor from each platform's ads is recognised: the URL parameter the
 * landing touch records, and the identity-graph column the stitch writes.
 * A platform absent here has no click-id funnel to show (postbacks, LinkedIn's
 * conversion rule), and its page says so instead of showing zeros.
 */
export const PLATFORM_CLICK: Record<string, { param: string; column: 'twclid' | 'gclid' | 'ttclid' | 'fbc' | 'epik' | 'li_fat_id' | null }> = {
  x: { param: 'twclid', column: 'twclid' },
  google_ads: { param: 'gclid', column: 'gclid' },
  tiktok: { param: 'ttclid', column: 'ttclid' },
  meta: { param: 'fbclid', column: 'fbc' },
  pinterest: { param: 'epik', column: 'epik' },
  linkedin: { param: 'li_fat_id', column: 'li_fat_id' },
  snapchat: { param: 'ScCid', column: null },
  microsoft_ads: { param: 'msclkid', column: null },
};

/** The browsing-event queue (outbox, AD_CONVERSION) status → outcome. */
export function outcomeOfQueueStatus(status: string | null | undefined): AdOutcome {
  switch (status) {
    case 'sent': return 'sent';
    case 'skipped': case 'suppressed': case 'withdrawn': return 'not_sent';
    case 'dead_letter': return 'failed';
    default: return 'waiting'; // pending, processing, retrying
  }
}

/** The order-path intent (measurement.delivery_intent) state → outcome. */
export function outcomeOfIntentState(state: string | null | undefined): AdOutcome {
  switch (state) {
    case 'ACCEPTED': case 'PROCESSED': return 'sent';
    case 'SUPPRESSED': case 'CANCELLED': return 'not_sent';
    case 'PENDING': case 'LEASED': case 'RETRY_WAIT': case 'UNKNOWN_OUTCOME': return 'waiting';
    default: return 'failed'; // DEAD_LETTER, QUARANTINED and anything not yet named
  }
}

const clip = (s: string, n = 180) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * An event that was never this platform's to count: the visitor did not come
 * from its ad, and the owner's setting says to report only those who did.
 * These are most of the shop's traffic. They are kept out of the page's
 * headline numbers, chart and list (and stated once, as a count), or the few
 * events that matter would be lost among them.
 */
export const isOutOfScope = (reason: string | null | undefined): boolean => reason === 'NO_X_CLICK';

/** The single sentence the queue recorded for every skip before the reasons were split (2026-10-01). */
const LEGACY_SKIP = /no equivalent event or required identifier/i;

/** One sentence for one delivery. `raw` is the stored reason (queue last_error or intent state_reason). */
export function explainOutcome(input: { platformName: string; outcome: AdOutcome; raw: string | null | undefined }): string {
  const { platformName: name, outcome } = input;
  const raw = (input.raw ?? '').trim();
  if (outcome === 'sent') return `Sent to ${name}.`;
  if (outcome === 'waiting') return raw ? `Waiting to retry. Last answer: ${clip(raw)}` : 'Queued; it goes out within a minute.';
  if (outcome === 'not_sent') {
    if (raw === 'CONSENT_DENIED') return 'The visitor refused advertising, so nothing was sent.';
    if (raw === 'NO_X_CLICK') return 'The visitor did not arrive from an X ad, so it is not X\'s to count (your "x_clicks" setting).';
    if (raw === 'NO_EVENT_ID') return `No event ID is saved for this event, so ${name} is not told about it. Add one on the Advertising page.`;
    if (raw === 'NO_IDENTIFIER' || raw === 'IDENTITY_UNAVAILABLE') return `Nothing ${name} can match on: no click id, and no contact detail it is allowed to use.`;
    if (raw === 'NO_TEST_CODE') return `${name} is in Test mode but no test event code is saved, so nothing is sent. Add the code on the Advertising page, or switch to Live.`;
    if (raw === 'EXPIRED_EVENT') return `Too old to send: ${name} accepts an event for a limited time after it happened.`;
    // Recorded before the reasons were split: it could have been any of the three above, so it says so.
    if (LEGACY_SKIP.test(raw)) return `Not sent: ${name} had no event ID for it, or nothing to match the visitor on.`;
    if (raw === 'ORDER_CANCELLED') return 'The order was cancelled before it was sent.';
    if (/switched off/i.test(raw)) return `${name} was switched off before this was sent.`;
    if (/decrypt|vault/i.test(raw)) return 'The stored keys could not be read. Re-enter them on the Advertising page.';
    return raw ? `Not sent: ${clip(raw)}` : 'Not sent.';
  }
  // failed
  // Meta names its refusals itself (code/subcode, its message, its trace id): say what the code means, and keep its words.
  const meta = /Meta error (\d+)(?:\/(\d+))?: /.exec(raw);
  if (meta) {
    const code = Number(meta[1]);
    const said = clip(raw.slice(raw.indexOf('Meta error')), 230);
    if (code === 190 || code === 102) return `Meta rejected the access token (expired, revoked or wrong). Generate a new one in Events Manager and re-enter it on the Advertising page. ${said}`;
    if (code === 10 || code === 200 || code === 294 || code === 3) return `The access token is not allowed to send to this dataset. In Events Manager, generate the token from this dataset's Conversions API settings. ${said}`;
    if (code === 100) return `Meta refused the event as invalid. ${said}`;
    if (code === 803 || code === 2500) return `Meta does not recognise the dataset ID. Check it on the Advertising page. ${said}`;
    return `Meta refused it. ${said}`;
  }
  if (/^CREDENTIALS\b/.test(raw)) return `${name} rejected the keys. Re-enter them on the Advertising page. ${clip(raw, 160)}`;
  if (/^RETRY_BUDGET_EXHAUSTED\b/.test(raw)) return 'Gave up after the allowed number of tries.';
  const http = /HTTP (\d{3})/.exec(raw)?.[1];
  if (http === '401' || http === '403') return `${name} refused the request (${http}): the keys were rejected, or the account's API access is not approved yet. ${clip(raw, 140)}`;
  if (http && http.startsWith('4')) return `${name} refused this event (${http}). ${clip(raw, 160)}`;
  return raw ? `Gave up after repeated failures. Last answer: ${clip(raw)}` : 'Gave up after repeated failures.';
}

export interface ActivityCount { day: string; event: string; outcome: AdOutcome; reason: string | null; n: number; lastAt: string | null }

/** The most common stored reason among the given counts, with how many times it occurred. */
export function topReason(counts: readonly ActivityCount[]): { reason: string | null; n: number } | null {
  const by = new Map<string, number>();
  for (const c of counts) by.set(c.reason ?? '', (by.get(c.reason ?? '') ?? 0) + c.n);
  let best: { reason: string | null; n: number } | null = null;
  for (const [reason, n] of by) if (!best || n > best.n) best = { reason: reason || null, n };
  return best;
}

/** Every calendar day in the window, oldest first, as YYYY-MM-DD (the caller supplies "today" in shop time). */
export function daysOfWindow(todayIso: string, days: number): string[] {
  const [y, m, d] = todayIso.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}
