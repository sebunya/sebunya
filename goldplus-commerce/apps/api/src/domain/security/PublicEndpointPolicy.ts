/**
 * Public-endpoint abuse-control policy. Pure domain — no Redis, Hono, adapters.
 *
 * The defect this closes: the previous limiter keyed its Redis counter on the
 * raw request path. A path is attacker-controlled — `/orders/1`, `/orders/2`,
 * `/x?a=1`, `/x?a=2`, a different case, an extra slash — so every distinct path
 * string minted a distinct counter, and the "global" 1000/min limit was really
 * 1000/min PER PATH PER CLIENT, i.e. unbounded budget by construction. A limit a
 * caller can multiply by varying its own input is not a limit.
 *
 * So the key is a ROUTE FAMILY drawn from a fixed, finite set. Path parameters,
 * case and trailing slashes collapse into the same family, and everything
 * uncategorised shares ONE `global` family per client rather than one per URL.
 * The family set is closed, so cardinality is bounded no matter what a caller
 * sends.
 *
 * Each family also declares what happens when the authoritative Redis store is
 * unreachable: human forms and reads degrade to a stricter local budget
 * (STRICT), while HMAC-authenticated provider webhooks degrade to a generous
 * local budget (GENEROUS) so a Redis blip cannot drop a payment confirmation —
 * "human forms and provider webhooks have distinct policies".
 */

export type RouteFamily =
  | 'auth-customer-login'
  | 'auth-admin-login'
  | 'auth-recovery'
  | 'order-lookup'
  | 'dealer-application'
  | 'quote-request'
  | 'issue-report'
  | 'fake-product-report'
  | 'verification'
  | 'consent-mutation'
  | 'surveys'
  | 'product-finder'
  | 'recommendations'
  | 'location-search'
  | 'telemetry'
  | 'payment-webhook'
  | 'cart'
  | 'global';

/** How a family behaves when the authoritative store is unreachable. */
export type OutagePolicy = 'STRICT' | 'GENEROUS';

export type EndpointClass =
  | 'AUTH'
  | 'HUMAN_FORM'
  | 'READ'
  | 'CONSENT'
  | 'TELEMETRY'
  | 'PROVIDER_WEBHOOK'
  | 'GENERAL';

export interface FamilyPolicy {
  family: RouteFamily;
  limit: number;
  windowMs: number;
  class: EndpointClass;
  outage: OutagePolicy;
}

const MINUTE = 60_000;

/**
 * Per-client budgets at TRUSTED confidence. `limitFor` in AbuseControlPolicy
 * then scales these by attribution confidence, and the shared unattributed
 * bucket gets its own larger global allowance so a degraded proxy cannot lock
 * out every unidentifiable client.
 */
const POLICIES: Record<RouteFamily, FamilyPolicy> = {
  // Credential-guessing surfaces: tight, strict local fallback.
  'auth-customer-login': { family: 'auth-customer-login', limit: 10, windowMs: MINUTE, class: 'AUTH', outage: 'STRICT' },
  'auth-admin-login': { family: 'auth-admin-login', limit: 10, windowMs: MINUTE, class: 'AUTH', outage: 'STRICT' },
  // Account recovery: requesting a reset sends an SMS or an email, and
  // completing one is a code-guessing surface. Tight per client, on top of the
  // per-account cooldown and hourly cap inside the use cases.
  'auth-recovery': { family: 'auth-recovery', limit: 5, windowMs: MINUTE, class: 'AUTH', outage: 'STRICT' },
  // Authenticated reads that could be walked for enumeration.
  'order-lookup': { family: 'order-lookup', limit: 60, windowMs: MINUTE, class: 'READ', outage: 'STRICT' },
  // Public human forms. Low ceilings — a person fills these a few times, a
  // script fills them thousands.
  'dealer-application': { family: 'dealer-application', limit: 5, windowMs: MINUTE, class: 'HUMAN_FORM', outage: 'STRICT' },
  'quote-request': { family: 'quote-request', limit: 10, windowMs: MINUTE, class: 'HUMAN_FORM', outage: 'STRICT' },
  'issue-report': { family: 'issue-report', limit: 10, windowMs: MINUTE, class: 'HUMAN_FORM', outage: 'STRICT' },
  'fake-product-report': { family: 'fake-product-report', limit: 10, windowMs: MINUTE, class: 'HUMAN_FORM', outage: 'STRICT' },
  'verification': { family: 'verification', limit: 20, windowMs: MINUTE, class: 'HUMAN_FORM', outage: 'STRICT' },
  // Consent mutations: authoritative record changes; generous enough for a real
  // preference-centre session, bounded against automated churn.
  'consent-mutation': { family: 'consent-mutation', limit: 60, windowMs: MINUTE, class: 'CONSENT', outage: 'STRICT' },
  'surveys': { family: 'surveys', limit: 60, windowMs: MINUTE, class: 'HUMAN_FORM', outage: 'STRICT' },
  // Product finder / shopping-assistant flow: interactive, so higher.
  'product-finder': { family: 'product-finder', limit: 120, windowMs: MINUTE, class: 'GENERAL', outage: 'STRICT' },
  // R9 (M2/M6): recommendation reads + the unauthenticated event write get
  // their OWN budget instead of riding the shared global family. Sized for
  // real browsing (a page fires ~4 rail reads + a handful of beacons); the
  // relay collapses storefront event traffic behind one container identity,
  // so the budget must cover site-wide beacon volume without letting one
  // client starve every other route's global allowance.
  'recommendations': { family: 'recommendations', limit: 600, windowMs: MINUTE, class: 'GENERAL', outage: 'STRICT' },
  // Address autocomplete fires per debounced keystroke burst (~2-4/s while a
  // customer types), well above product-finder's step cadence — 300/min covers
  // honest typing with headroom while still capping scripted scraping of the
  // gazetteer. STRICT on Redis outage: search degrades to the offline metro
  // index / district select, so failing closed costs nothing.
  'location-search': { family: 'location-search', limit: 300, windowMs: MINUTE, class: 'READ', outage: 'STRICT' },
  // High-volume, low-value beacons. Per-second window matches the prior control.
  'telemetry': { family: 'telemetry', limit: 100, windowMs: 1_000, class: 'TELEMETRY', outage: 'STRICT' },
  // Provider callbacks / IPN. HMAC-authenticated separately, low volume, high
  // value — a generous local budget on Redis outage so a real payment
  // confirmation is never dropped, still bounded per replica.
  'payment-webhook': { family: 'payment-webhook', limit: 300, windowMs: MINUTE, class: 'PROVIDER_WEBHOOK', outage: 'GENEROUS' },
  'cart': { family: 'cart', limit: 120, windowMs: MINUTE, class: 'GENERAL', outage: 'STRICT' },
  // Everything else: ONE shared budget per client, not one per URL.
  'global': { family: 'global', limit: 1000, windowMs: MINUTE, class: 'GENERAL', outage: 'STRICT' },
};

export function publicEndpointPolicy(family: RouteFamily): FamilyPolicy {
  return POLICIES[family];
}

/** All declared policies, for tests and operator inventory. */
export function allPublicEndpointPolicies(): FamilyPolicy[] {
  return Object.values(POLICIES);
}

/**
 * Normalise a path so attacker-controlled surface variation collapses:
 * lowercase, strip the query string, collapse duplicate slashes, drop a
 * trailing slash (except root). Case-insensitive because the limiter runs
 * before routing, so `/Auth/Login` must count against the same budget as
 * `/auth/login` even though it would 404.
 */
export function normalisePath(path: string): string {
  const withoutQuery = path.split('?')[0].split('#')[0];
  const collapsed = withoutQuery.replace(/\/{2,}/g, '/').toLowerCase();
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
  return trimmed || '/';
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Map a request to exactly one route family. Ordered most-specific first.
 * Deterministic and total: every input returns a member of the closed set, so
 * the counter cardinality cannot grow with caller input.
 */
export function classifyPublicEndpoint(method: string, rawPath: string): RouteFamily {
  const path = normalisePath(rawPath);
  const post = method.toUpperCase() === 'POST';

  // Provider callbacks / IPN — any method, so a provider retry with GET is still
  // classified as the webhook family rather than leaking into global.
  if (isUnder(path, '/webhooks/payment')) return 'payment-webhook';

  // Auth.
  if (post && path === '/auth/login') return 'auth-customer-login';
  if (post && path === '/auth/admin/login') return 'auth-admin-login';
  if (post && isUnder(path, '/auth/password')) return 'auth-recovery';

  // Telemetry beacons.
  if (isUnder(path, '/telemetry/collect')) return 'telemetry';
  // Battery finder: a request is a human form (contact details, a row per
  // submission); an event is a beacon.
  if (post && path === '/batteries/finder/requests') return 'quote-request';
  if (post && path === '/batteries/finder/events') return 'telemetry';

  // Public human forms (governance).
  if (path === '/governance/dealers/apply') return 'dealer-application';
  if (path === '/governance/quotes/request') return 'quote-request';
  if (path === '/governance/support/report-issue') return 'issue-report';
  if (path === '/governance/support/report-fake') return 'fake-product-report';
  if (isUnder(path, '/governance/verification')) return 'verification';
  if (isUnder(path, '/governance/support')) return 'issue-report';

  // Consent mutations (public signal/withdraw and the operating layer).
  if (isUnder(path, '/consent')) return 'consent-mutation';
  if (isUnder(path, '/account/consent-operating')) return 'consent-mutation';

  // Surveys and order lookup live under /account; match before the generic
  // account fall-through so each gets its own budget.
  if (isUnder(path, '/account/surveys')) return 'surveys';
  if (isUnder(path, '/account/orders')) return 'order-lookup';

  // Product finder / shopping assistant.
  if (isUnder(path, '/recommendations')) return 'recommendations';
  if (isUnder(path, '/product-finder')) return 'product-finder';

  if (isUnder(path, '/locations')) return 'location-search';

  // Cart mutations.
  if (isUnder(path, '/commerce/cart')) return 'cart';

  // Everything else shares one bounded budget per client.
  return 'global';
}
