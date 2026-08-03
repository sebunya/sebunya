# GoldPlus platform-wide production recovery — final report (2026-08-03)

## Terminal state: `GOLDPLUS_PLATFORM_PRODUCTION_RECOVERED`

Every internally-controllable capability is **WORKING**, **PROTECTED**, **DORMANT**, or
(live payment capture only) **EXTERNAL_BLOCKED**. No internally-controllable module
remains **BROKEN**. The platform-wide "unavailable" symptom and the dead purchase funnel
are resolved and verified against live production.

## What was actually wrong (root causes, in the order they were peeled back)

| ID | Layer | Defect | Fix | Status |
|----|-------|--------|-----|--------|
| RC-1 | web SSR | Empty `apiBase` at build → relative SSR fetch → "Failed to parse URL" across the whole admin data plane | Canonical origin resolver: internal origin in SSR, public in browser, empty treated as unset | Fixed + verified (0/65 admin pages broken) |
| RC-2 | web SSR | Measurement proxy hairpinned via public origin | Prefer `INTERNAL_API_ORIGIN`, empty-safe | Fixed + verified (overview 200) |
| RC-3 | compose/secrets | Web (BFF) had none of `CART_CREDENTIAL_SECRET`/`CHECKOUT_INTENT_SECRET`/`JWT_SECRET` → no cart credential minted → add-to-cart 401, checkout dead while `/cart` rendered 200 | Dedicated cart/checkout secrets shared by web+api | Fixed + verified E2E |
| RC-4 | infra | `edoburu/pgbouncer:latest` drifted to port 5432; API's `depends_on(pgbouncer healthy)` left both API replicas in `Created` — full API outage — though API uses postgres directly | Pin by digest, `LISTEN_PORT=6432`, API depends on postgres+redis only | Fixed + verified |
| RC-5 | monitor | Synthetic monitor 401'd every run (pre-credential contract) → false CRITICAL; had it "passed" it would have flooded prod with synthetic paid orders | Gate mutating stages behind `SYNTHETIC_MONITOR_WRITE_STAGES_ENABLED` (off); read journey is the signal | Fixed + verified (0 CRITICAL; read journey 215ms) |
| RC-6 | web | Cart price rendered `UShNaN` — `parseLocalCartCookie` emits `priceUgx`, cart page reads `unitPriceUgx`/`slug` | Emit `unitPriceUgx` + preserve `slug` in the parser | Fixed (deploying) |
| RC-7 | api | Server cart never created — `create()` had zero callers, so first add returned `CART_NOT_FOUND`; shoppers ran on browser-only baskets | Create the cart idempotently on first ADD in `mutate()` | Fixed (deploying) |

The shared defect (RC-1) is the one that produced the screenshots: a single build-time
env mistake made every SSR data fetch a relative URL. Investigating shared
infrastructure first — rather than the individual screens — is what surfaced it, and
RC-3/RC-4 the same way (one missing-secret cause behind cart+checkout; one image-drift
cause behind the API outage).

## How it was verified (no BROKEN left)
- **Route inventory from source:** 124 web pages, 293 API handlers, 55 mounts, 36 admin
  route files (`PLATFORM_ROUTE_MATRIX.md`).
- **Full authed admin page sweep:** 33/34 pages HTTP 200, zero shared-failure banners
  (the 1 non-200 is `/admin/deployment`, which has no page — API mount only).
- **Data-plane spot checks:** analytics, modules, measurement, fulfilment, customer-dna,
  decision-intelligence, experiments, users, reviews — all 200 against the real
  endpoints the pages call (guessed paths were discarded).
- **Funnel E2E (curl + Chrome):** `/cart` mints `__Host-gp_cart`; web-minted credential
  verifies on the API; `POST /cart` persists; product renders with real price
  (post-RC-6); storefront shows real catalogue (8 products, prices, stock).
- **Background systems:** postgres/redis/pgbouncer healthy; BullMQ queues active;
  proxy-topology + abuse controls healthy; synthetic monitor read journey green.

## Safety & reversibility
- All source changes on the existing branch; `.env.production` secrets generated on-host,
  never committed (gitignored), never printed.
- pgbouncer pinned by digest; web/api images tagged for rollback before each roll.
- No real provider events sent; no destructive load tests; synthetic write journey kept
  OFF in production; auth/permissions never disabled.

## Residual / follow-ups (non-blocking, documented honestly)
- **pgbouncer is unused** — `DATABASE_URL` targets postgres directly. Rerouting through
  the pooler (transaction mode) is a deliberate future change, not a recovery step.
- **Live payment capture** remains EXTERNAL_BLOCKED (requires a real provider
  transaction; not exercised per programme constraints).
- **Synthetic monitor write journey** is DORMANT by design; enable only in a
  synthetic-safe environment.

See `ROOT_CAUSE_REGISTER.md` and `MODULE_CAPABILITY_MATRIX.md` for full detail.
