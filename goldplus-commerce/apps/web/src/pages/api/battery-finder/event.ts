import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { readBodyCapped } from '../../../lib/boundedBody';
import { apiHeaders, readClientAddress } from '../../../lib/forwardClient';

/**
 * A search engine that renders the page would fire RESULT_VIEWED on every crawl
 * and the demand report would count crawls as customers. Known crawlers are
 * acknowledged and dropped; the click-driven events (PRODUCT_VIEWED, ADDED_TO_CART)
 * are the reliable half of the funnel either way (docs/growth/README.md §7).
 */
const CRAWLER_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|curl\/|python-requests/i;

/**
 * Same-origin relay for the finder's own funnel events (0125
 * battery_finder_events): a phone page viewed, a battery opened from it, a
 * battery added to the basket for a phone. The API accepted these since the
 * module shipped; nothing in the browser sent them, so the demand report's
 * "product views" and "basket adds" read 0 for every phone. Only the four
 * fields the API validates are forwarded; the finder session comes from the
 * same cookie the finder page reads, so the event joins the search it followed.
 */
const EVENT_TYPES = new Set(['RESULT_VIEWED', 'PRODUCT_VIEWED', 'ADDED_TO_CART']);
const MODES = new Set(['FIND_BY_PHONE', 'SEARCH_CODE', 'PRODUCT_PAGE', 'CART']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,160}$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async (context) => {
  const { request, cookies } = context;
  if (CRAWLER_UA.test(request.headers.get('user-agent') ?? '')) return json(202, { success: true, data: { recorded: false } });
  const read = await readBodyCapped(request, 1024);
  if (!read.ok) return json(413, { success: false, error: { code: 'TOO_LARGE', message: 'Too long.' } });
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(read.text) ?? {}; } catch { raw = {}; }
  const eventType = typeof raw.eventType === 'string' && EVENT_TYPES.has(raw.eventType) ? raw.eventType : null;
  const mode = typeof raw.mode === 'string' && MODES.has(raw.mode) ? raw.mode : null;
  if (!eventType || !mode) return json(400, { success: false, error: { code: 'INVALID_BODY', message: 'Invalid event.' } });
  const body = {
    eventType,
    mode,
    deviceSlug: typeof raw.deviceSlug === 'string' && SLUG.test(raw.deviceSlug) ? raw.deviceSlug : null,
    productId: typeof raw.productId === 'string' && UUID.test(raw.productId) ? raw.productId : null,
    outcome: typeof raw.outcome === 'string' && /^[A-Z_]{1,40}$/.test(raw.outcome) ? raw.outcome : null,
  };
  const session = cookies.get('goldplus_cart_session')?.value ?? cookies.get('gp_finder')?.value ?? null;
  try {
    const upstream = await fetch(`${apiBase}/batteries/finder/events`, {
      method: 'POST',
      // The customer's address, not the web container's: the API's per-address limits and session hashing stay per person.
      headers: apiHeaders({ 'Content-Type': 'application/json', ...(session ? { 'x-gp-finder-session': session } : {}) }, readClientAddress(context)),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    return json(upstream.ok ? 202 : upstream.status, { success: upstream.ok, data: { recorded: upstream.ok } });
  } catch {
    // A lost beacon is not the customer's problem: the page never waits on this.
    return json(202, { success: false, data: { recorded: false } });
  }
};
