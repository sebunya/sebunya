# Root cause register — 2026-08-03 platform-wide recovery

## RC-1 (SHARED, CRITICAL) — SSR_RELATIVE_URL / BUILD_TIME_ENV_INCORRECT
**Evidence:** `/admin/analytics` renders `Failed to parse URL from /admin/analytics/overview`;
`/admin`, `/admin/platform-modules`, `/admin/inventory`, `/admin/audit`,
`/admin/compatibility` render "service unavailable". The built web SSR bundle has
`apiBase` = "" (empty): the web image was built without `PUBLIC_API_BASE_URL`
passed to the build arg, and `apis.ts` used `?? 'http://localhost:3000'` which does
NOT catch an empty string, so `apiBase` stayed "". Every `${apiBase}${path}` fetch
became a RELATIVE URL, which Node's SSR `fetch` rejects ("Failed to parse URL").

**Affected:** all ~78 web files that build requests via `apiBase` (admin data plane,
platform modules, analytics, inventory, audit, compatibility, notifications, …).

**Canonical fix (§10.2):**
1. `apps/web/src/lib/api.ts`: treat empty as unset (`||` not `??`); in SSR use an
   absolute INTERNAL origin read at runtime (`process.env.INTERNAL_API_ORIGIN` =
   `http://api:3000`, the api container on the compose network — verified reachable
   from web), never the public hairpin; browser keeps the public origin.
2. `docker-compose.production.yml`: add `INTERNAL_API_ORIGIN=http://api:3000` to the
   web service environment.
3. Rebuild the web image WITH the build args (`--env-file .env.production`) so the
   browser bundle's public origin is correct too.

**Regression test:** architecture test forbidding empty-base relative SSR fetch;
Playwright asserting no "Failed to parse URL"/"service unavailable" banner on the
admin data-plane routes; container test web→`http://api:3000/health` = 200.

**Release impact:** web image rebuild only (no schema change). Reversible by
redeploying the prior web image.

## RC-2 (fixed, deployed with RC-3) — measurement SSR proxy origin
`apps/web/src/pages/api/admin/measurement/[...path].ts` resolved its upstream from
`PUBLIC_API_BASE_URL ?? localhost` — a public-edge hairpin. Made it prefer
`INTERNAL_API_ORIGIN`, empty-safe, mirroring `lib/api.ts`. Commit `706dfaa`.
(The client-side `/api/admin/measurement/*` calls are same-origin to the storefront,
handled by this Astro route — no Caddy `/api` rule needed. Verified: overview 200.)

## RC-3 (SHARED, CRITICAL) — WEB BFF SIGNING SECRETS MISSING → cart + checkout dead
**Symptom the page-render sweep MISSED:** `/cart` renders HTTP 200 but the *write*
path is dead. Live proof: `GET https://shopgoldplus.com/cart` returns **no
`Set-Cookie`** — the storefront never mints `__Host-gp_cart`. `POST /commerce/cart/add`
returns `401 CART_CREDENTIAL_REQUIRED`. The scheduled `SyntheticMonitor` fails every
15s at `add_to_cart` (surfaced the thread, though its own 401 is a separate monitor
gap — it presents no signed credential).

**Root cause:** the web container's environment contained only NODE_ENV, PORT, HOST,
`PUBLIC_API_BASE_URL`, `INTERNAL_API_ORIGIN`, NODE_OPTIONS. The storefront is the
Backend-for-Frontend that MINTS the signed cart credential and checkout intent
(`apps/web/src/lib/cartCredential.ts`, `checkoutIntent.ts`). Both derive their keyring
from `CART_CREDENTIAL_SECRET|CHECKOUT_INTENT_SECRET → JWT_SECRET`. **None of the three
was present in the web container**, so `keys()`/`intentKeys()` returned `null`, the
storefront degraded to a local-only basket, and the API (verifying with its own real
`JWT_SECRET`) rejected everything. Secret hashes confirmed: web CART/JWT = empty-string
hash; API JWT = real. → entire add-to-cart → checkout → payment funnel non-functional.

**Canonical fix:** introduce dedicated `CART_CREDENTIAL_SECRET` + `CHECKOUT_INTENT_SECRET`
(distinct from JWT_SECRET so the cart/intent key streams stay isolated from the
session-token stream), wired to BOTH the `web` and `api` services in
`docker-compose.production.yml`, values in gitignored `.env.production` (generated on
host, 32 bytes each). Web mints; API verifies; both from the same explicit secret. No
live basket is invalidated because the storefront had never successfully minted one.

**Regression test:** route-contract asserts `/cart` responds with a `__Host-gp_cart`
`Set-Cookie`; browser proof adds a product and reads it back from the server cart.

**Release impact:** compose env + `.env.production` only (no rebuild strictly needed —
runtime env). Reversible by reverting the compose env lines. Rolled together with the
RC-2 web image.

**Verified live (end-to-end):** `GET /cart` now sets `__Host-gp_cart`
(HttpOnly/Secure/SameSite=Lax); a web-minted credential presented to the API no longer
returns `401 CART_CREDENTIAL_REQUIRED` (signature verifies); the real BFF flow
`POST /cart action=add` → 303 and a subsequent `GET /cart` shows the product persisted
in the SERVER cart (Quantity/Subtotal, no error banner).

## RC-4 (INFRA, HIGH) — pgbouncer `:latest` drift blocked the API via depends_on
**Discovered during the RC-3 rollout.** `up -d api web` re-pulled
`edoburu/pgbouncer:latest`, whose default `listen_port` is now 5432. The compose
healthcheck and published port both target 6432, so pgbouncer reported **unhealthy**,
and the API's `depends_on: pgbouncer: service_healthy` left both API replicas stuck in
`Created` — a full API outage — even though the API connects to `postgres:5432`
**directly** and never uses pgbouncer.

**Immediate recovery:** `docker start` the already-created API containers (they held the
RC-3 secrets) to bypass the dependency gate; API healthy in ~10s.

**Canonical fix:** (1) pin `edoburu/pgbouncer:1.25.2`; (2) set `LISTEN_PORT=6432` so the
process, healthcheck and mapping agree; (3) point the API's `depends_on` at
postgres+redis (what it actually uses), not the unused pooler.

**Observation (not changed during recovery):** `DATABASE_URL` bypasses pgbouncer and
hits postgres directly, so the connection pooler provides no benefit today. Rerouting
through pgbouncer (transaction pooling) is a deliberate follow-up, not a recovery step.

**Fixed live:** pgbouncer pinned by digest, `LISTEN_PORT=6432`, healthy; API depends on
postgres+redis only. Full API recreate now succeeds cleanly (verified with RC-5 roll).

## RC-5 (MONITOR, MEDIUM) — synthetic monitor: false CRITICAL + prod-pollution risk
**Symptom:** `[SyntheticMonitor] CRITICAL: Synthetic commerce check failed` every run,
failing at `add_to_cart` with 401. The monitor's cart call used the **pre-credential**
contract (`{cartId, item}` body, no `x-goldplus-cart` header), so it could never pass —
alert-fatigue noise that masks real incidents.

**The deeper hazard:** had the cart stage been "fixed" to pass, the monitor would have
run its full write journey — `/commerce/checkout` (creates a REAL order),
`/webhooks/payment/mtn` (marks it paid), notification outbox — **every run**, flooding
production with synthetic paid orders and real notification sends. Its failure was
accidentally shielding production.

**Fix:** gate the mutating stages behind `SYNTHETIC_MONITOR_WRITE_STAGES_ENABLED`
(default false; compose passes it explicitly). With it off, the read-only journey
(storefront HTML, catalogue parity, PDP, recommendations) runs and is the health signal;
the monitor returns success on the read path. Verified live: CRITICAL failures dropped
to 0 after the RC-5 roll. Classification: write journey **DORMANT** (intentional,
opt-in), read journey **WORKING**.

## RC-6 (WEB, HIGH — found via browser proof) — cart price renders `UShNaN`
**Symptom:** after adding to cart, the cart line, subtotal and total all render
**`UShNaN`**; PDP links on those lines point to `/products/` (undefined slug). Seen in a
real Chrome session and reproduced with a clean curl session.

**Root cause:** `apps/web/src/lib/cart.ts` `parseLocalCartCookie()` returns each item
with the field `priceUgx`, but `apps/web/src/pages/cart.astro` reads `item.unitPriceUgx`
(and `item.slug`). On the local-cookie fallback render path those are `undefined`, so
`formatUgx(undefined)` → `Intl.NumberFormat.format(NaN)` → `UShNaN`, and the subtotal
`Σ unitPriceUgx*qty` is `NaN`.

**Fix:** `parseLocalCartCookie` now also emits `unitPriceUgx` (= the resolved price) and
preserves `slug`, keeping the fallback item shape in sync with its only cart-page
consumer. Additive; the shared `priceUgx` field other callers use is unchanged.

## RC-7 (API, MEDIUM) — server cart never created → add returns CART_NOT_FOUND
**Symptom:** `GET /commerce/cart` with a valid, signature-verified credential returns
`CART_NOT_FOUND`; the storefront silently runs on the browser-only local basket.

**Root cause:** the storefront mints a signed credential naming a `cartId` + owner but
never creates the DB row, and `MutateCartUseCase.authorize()` refuses a missing cart.
`ICartAuthorizedRepository.create()` existed on the Drizzle repo but had **zero callers**
— so no server cart was ever created, for anyone. Not funnel-fatal only because
`/orders/create` prices `body.items` sent by the client, not the server cart; the local
basket + client-item checkout is the actual working path, and the failed server add is
swallowed behind the POST's 303 (never shown).

**Fix:** add `create()` to the repository interface and, in `mutate()`, create the cart
(idempotent, `onConflictDoNothing`) on the first `ADD` when it is missing, then
authorize. REMOVE/UPDATE/CLEAR on a missing cart remain genuine not-founds. This lifts
the server-cart capability from BROKEN to WORKING and makes `cart.astro`'s server render
path (correctly priced by the use case) the primary path, with the RC-6 fallback behind
it.
