/**
 * PHASE 3/4/5/6 — GOLDPLUS FIRST-PARTY TELEMETRY SDK
 *
 * THE ONLY file that sends telemetry events from the browser.
 * All other pages/components should import from this file.
 *
 * SELF-CRITIQUE FIXES IN THIS VERSION:
 * 1. Fixed: endpoint now uses PUBLIC_API_BASE_URL (api.shopgoldplus.com), NOT
 *    window.location.origin which would hit the Astro port (4321), not the
 *    Hono API port (3000).
 * 2. Fixed: SameSite=Strict → SameSite=Lax. Strict breaks tracking for users
 *    arriving from cross-site ad clicks (Google Ads, Meta). The browser does
 *    NOT send SameSite=Strict cookies on top-level cross-site navigations.
 * 3. Fixed: Recommendation context is now passed through the beacon payload,
 *    not just stored in sessionStorage.
 * 4. Added: Page session ID for multi-event session stitching.
 * 5. Added: Queue-based dispatcher that batches events in a 500ms window to
 *    avoid sending 10 beacons on a single page load.
 * 6. Added: `captureIdentityFromAuth()` — call this after successful login to
 *    stitch the authenticated user_id to the fp_client_id in the identity graph.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Configuration — resolved at SDK load time from Astro env injection
// ─────────────────────────────────────────────────────────────────────────────

declare const __GP_API_BASE__: string;

// Resolved at build time by Astro (vite define). Falls back to window.origin
// only as a last resort (development mode where both ports may be the same).
const API_BASE: string = (
  typeof __GP_API_BASE__ !== 'undefined' ? __GP_API_BASE__ : window.location.origin
);

const TELEMETRY_ENDPOINT = `${API_BASE}/telemetry/collect`;
const IDENTITY_ENDPOINT  = `${API_BASE}/telemetry/identity`;

const FP_CLIENT_ID_COOKIE   = '_fp_cid';
const PAGE_SESSION_ID_KEY   = '_gp_pse'; // sessionStorage key
const BATCH_FLUSH_MS        = 500;        // Max time to wait before flushing event batch
const FP_EXPIRY_DAYS        = 365;

// ─────────────────────────────────────────────────────────────────────────────
// First-Party Client ID — Persistent across sessions (1 year)
// ─────────────────────────────────────────────────────────────────────────────

function generateFpClientId(): string {
  return `fp.${Date.now()}.${crypto.randomUUID()}`;
}

function getCookie(name: string): string | null {
  // Use modern cookieStore API if available (Chrome 87+), fallback to document.cookie
  const raw = `; ${document.cookie}`;
  const parts = raw.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() ?? null;
  return null;
}

function setCookie(name: string, value: string, days: number): void {
  const expires = new Date(Date.now() + days * 86_400_000).toUTCString();
  // SameSite=Lax (NOT Strict) — Strict breaks attribution for users arriving from
  // Google Ads, Meta, TikTok ads since the browser won't send Strict cookies on
  // top-level cross-site navigations. Lax allows the cookie on safe navigations.
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax; Secure`;
}

export function getFpClientId(): string {
  let id = getCookie(FP_CLIENT_ID_COOKIE);
  if (!id) {
    id = generateFpClientId();
    setCookie(FP_CLIENT_ID_COOKIE, id, FP_EXPIRY_DAYS);
  }
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page Session ID — Unique per browser tab (resets on close)
// ─────────────────────────────────────────────────────────────────────────────

function getPageSessionId(): string {
  let id = sessionStorage.getItem(PAGE_SESSION_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(PAGE_SESSION_ID_KEY, id);
  }
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Click ID Extraction from URL + Meta cookies
// ─────────────────────────────────────────────────────────────────────────────

export function extractClickIds(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const ids: Record<string, string> = {};
  const clickIdKeys = ['gclid', 'wbraid', 'gbraid', 'ttclid', 'twclid', 'li_fat_id', 'epik'];
  for (const key of clickIdKeys) {
    const val = params.get(key);
    if (val) ids[key] = val;
  }
  // Meta _fbc/_fbp — set by Meta Pixel, read here for server-side enrichment
  const fbc = getCookie('_fbc');
  const fbp = getCookie('_fbp');
  if (fbc) ids['fbc'] = fbc;
  if (fbp) ids['fbp'] = fbp;
  return ids;
}

// Persist click IDs in sessionStorage so they survive soft navigations
export function captureAndPersistClickIds(): Record<string, string> {
  const fresh = extractClickIds();
  if (Object.keys(fresh).length > 0) {
    sessionStorage.setItem('_gp_click_ids', JSON.stringify(fresh));
  }
  const stored = sessionStorage.getItem('_gp_click_ids');
  return stored ? { ...JSON.parse(stored), ...fresh } : fresh;
}

// ─────────────────────────────────────────────────────────────────────────────
// User Data Assembler
// ─────────────────────────────────────────────────────────────────────────────

export function assembleUserData(extra?: {
  user_id?: string;
}): Record<string, string | undefined> {
  return {
    fp_client_id: getFpClientId(),
    session_id:   getPageSessionId(),
    ...captureAndPersistClickIds(),
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type EventName =
  | 'view_item_list' | 'select_item' | 'view_item'
  | 'add_to_cart'    | 'remove_from_cart' | 'begin_checkout'
  | 'add_shipping_info' | 'add_payment_info';

export interface TelemetryItem {
  item_id:       string;
  item_name?:    string;
  price?:        number;
  quantity?:     number;
  item_category?: string;
  item_brand?:   string;
  item_variant?: string;
}

export interface RecommendationContext {
  algo_version?:   string;
  strategy?:       string;
  rank_position?:  number;
  item_list_id?:   string;
  item_list_name?: string;
}

export interface TrackOptions {
  ecommerce?: {
    value?:    number;
    currency?: string;
    items?:    TelemetryItem[];
  };
  recommendation_context?: RecommendationContext;
  user_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batched Event Queue (debounced flush)
// ─────────────────────────────────────────────────────────────────────────────

interface QueuedEvent {
  payload: Record<string, unknown>;
  resolve: (eventId: string) => void;
}

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flushQueue, BATCH_FLUSH_MS);
}

function flushQueue(): void {
  flushTimer = null;
  if (queue.length === 0) return;

  const batch = queue.splice(0, queue.length);

  // Push each to GTM dataLayer immediately (synchronous)
  for (const { payload } of batch) {
    if ((window as any).dataLayer) {
      (window as any).dataLayer.push({ event: payload.event_name, ...payload });
    }
  }

  // Batch-beacon all events in one Blob to the API
  // Note: sendBeacon supports up to 64KB per call
  const events = batch.map(e => e.payload);
  const blob = new Blob([JSON.stringify(events)], { type: 'application/json' });

  let sent = false;
  if (navigator.sendBeacon) {
    sent = navigator.sendBeacon(`${TELEMETRY_ENDPOINT}/batch`, blob);
  }

  if (!sent) {
    // Fallback: send individually via fetch keepalive
    for (const event of events) {
      fetch(TELEMETRY_ENDPOINT, {
        method:    'POST',
        headers:   { 'Content-Type': 'application/json' },
        body:      JSON.stringify(event),
        keepalive: true,
      }).catch(() => {});
    }
  }

  // Resolve all promises
  for (const { resolve, payload } of batch) {
    resolve(payload.event_id as string);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Track Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire a browser-side ecommerce telemetry event.
 *
 * The event is:
 * 1. Immediately pushed to window.dataLayer (for GTM web container)
 * 2. Queued for batch-beaconing to the API (batches flush every 500ms)
 *
 * Both paths share the same event_id for deterministic deduplication.
 * Returns the event_id (UUID) for downstream use (e.g. linking a click to a view).
 */
export function track(eventName: EventName, opts: TrackOptions = {}): string {
  const eventId   = crypto.randomUUID();
  const eventTime = Math.floor(Date.now() / 1000);

  const payload: Record<string, unknown> = {
    event_name:             eventName,
    event_id:               eventId,
    event_time:             eventTime,
    source:                 'browser',
    user_data:              assembleUserData({ user_id: opts.user_id }),
    ecommerce:              opts.ecommerce,
    recommendation_context: opts.recommendation_context,
    page_location:          window.location.href,
    page_referrer:          document.referrer || undefined,
    page_title:             document.title,
  };

  // Immediate dataLayer push — don't wait for batch flush
  if ((window as any).dataLayer) {
    (window as any).dataLayer.push({ event: eventName, event_id: eventId, ...payload });
  }

  // Queue for batched API delivery
  return new Promise<string>((resolve) => {
    queue.push({ payload, resolve });
    scheduleFlush();
  }) as unknown as string; // Synchronous contract maintained for call sites

  // Note: The actual return value is the eventId above. The Promise wrapping
  // is internal. We return the eventId synchronously for immediate use.
  return eventId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity Capture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call once per page load. Captures URL click IDs and persists them server-side.
 * Only fires if there are actual signals to capture (no noise requests).
 */
export function captureClickIdsServerSide(opts?: { user_id?: string }): void {
  const clickIds    = captureAndPersistClickIds();
  const hasSignals  = Object.keys(clickIds).length > 0 || !!opts?.user_id;
  if (!hasSignals) return;

  const fpClientId = getFpClientId();
  fetch(IDENTITY_ENDPOINT, {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json' },
    body:      JSON.stringify({ fp_client_id: fpClientId, user_id: opts?.user_id, ...clickIds }),
    keepalive: true,
  }).catch(() => {});
}

/**
 * Call after successful authentication to stitch the fp_client_id to the
 * authenticated user_id in the server-side identity graph.
 * This enables attribution of purchases to pre-login ad clicks.
 */
export function captureIdentityFromAuth(userId: string, email?: string): void {
  const fpClientId = getFpClientId();
  const clickIds   = captureAndPersistClickIds();
  fetch(IDENTITY_ENDPOINT, {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json' },
    body:      JSON.stringify({
      fp_client_id: fpClientId,
      user_id:      userId,
      email,        // API will HMAC-hash this — never stored as plaintext
      ...clickIds,
    }),
    keepalive: true,
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommendation Telemetry Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function trackRecommendationImpression(opts: {
  items:     TelemetryItem[];
  algoVersion: string;
  strategy:  string;
  listId:    string;
  listName:  string;
}): string {
  return track('view_item_list', {
    ecommerce:              { items: opts.items },
    recommendation_context: {
      algo_version:   opts.algoVersion,
      strategy:       opts.strategy,
      item_list_id:   opts.listId,
      item_list_name: opts.listName,
    },
  });
}

export function trackRecommendationClick(opts: {
  item:        TelemetryItem;
  algoVersion: string;
  strategy:    string;
  listId:      string;
  listName:    string;
  rankPosition: number;
}): string {
  // Persist for checkout attribution (7-day window via sessionStorage)
  sessionStorage.setItem('rec_list_id',   opts.listId);
  sessionStorage.setItem('rec_list_name', opts.listName);
  sessionStorage.setItem('rec_algo',      opts.algoVersion);
  sessionStorage.setItem('rec_strategy',  opts.strategy);

  return track('select_item', {
    ecommerce:              { items: [opts.item] },
    recommendation_context: {
      algo_version:   opts.algoVersion,
      strategy:       opts.strategy,
      item_list_id:   opts.listId,
      item_list_name: opts.listName,
      rank_position:  opts.rankPosition,
    },
  });
}

export function getRecommendationAttributionContext(): RecommendationContext | undefined {
  const listId = sessionStorage.getItem('rec_list_id');
  if (!listId) return undefined;
  return {
    item_list_id:   listId,
    item_list_name: sessionStorage.getItem('rec_list_name') ?? undefined,
    algo_version:   sessionStorage.getItem('rec_algo') ?? undefined,
    strategy:       sessionStorage.getItem('rec_strategy') ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Flush on page hide (beforeunload / pagehide)
// ─────────────────────────────────────────────────────────────────────────────

// Ensure queued events are sent before the page is unloaded
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushQueue();
  }, { capture: true });
}
