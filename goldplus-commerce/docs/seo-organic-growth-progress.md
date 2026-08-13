# Organic Search Dominance OS — Build Progress Log

Interruption-safe continuation point. Updated after every materially green
tranche so a lost session resumes here instead of re-deriving state.

## Tranche 1 — COMPLETE, DEPLOYED (2026-08-10)

Data layer, RBAC, admin API, crawler, Control Centre, GSC/Merchant/IndexNow
connectors. Shipped at `8af8186`, deployed to production.

## Tranche 2 Wave 1 — COMPLETE (2026-08-10), commit `2dd6f10`

- Search Integrations Control Plane **backend**: migration 0118 (6 tables),
  credential vault (AES-256-GCM), Google OAuth2 + PKCE, 14 provider manifests,
  20 admin routes, 13-state connection lifecycle, SSRF-guarded custom
  read-only REST connector, sync worker. 38 tests.
- Category authority engine with release gates, `/power` `/audio` and the
  child hubs, `/locations/wilson-road`, `/delivery/kampala-wakiso`, hub
  sitemap. 22 tests.
- Competitor reconciliation against the 58-entry source workbook.

## Tranche 2 Wave 2 — COMPLETE (2026-08-13)

Both wave-2 background agents died mid-build (one on a dropped connection, one
stalled). Their partial work was **recovered from the working tree, not
rebuilt**, and completed directly.

### `7bc8fed` — Integrations admin UI (recovered + completed)

Recovered: `adminSeoIntegrations.ts` (284 lines), `integrations/index.astro`.
Completed: `integrations/[provider].astro` (connections, masked vault
credentials with rotate/revoke, staged test stage-results, discovery +
resource selection, manual sync, quota usage, audit trail, OAuth entry),
`integrations/[provider]/connect.astro` (wizard),
`integrations/sync.astro` (Sync Operations Center).

Honesty invariants held: no secret is ever rendered back, no fabricated health
score, NO DATA distinct from STALE, no "Coming Soon"-class placeholder.

### `1c2e96c` — Catalogue intelligence (recovered + completed)

Recovered: migration 0119, `schema/seo-catalogue.ts`,
`BatteryCompatibilityUseCases.ts`.
Completed: `StorageTestUseCases.ts`, `ProductLifecycleSeoUseCases.ts`,
`DrizzleSeoCatalogueRepository.ts`, `routes/admin/seo-catalogue.ts`, public
`GET /seo/battery-finder`, three admin pages, `/battery-finder` storefront
page, 41 tests.

Bug found and fixed by the new tests: `capacityRatio` coerced a missing
measurement (`null`) to `0` via `Number()`, which would have reported an
**untested** drive as a **FAIL**. Unmeasured now returns `null` →
`INCONCLUSIVE`.

## Tranche 2 Wave 3 — COMPLETE (2026-08-13)

Migration 0120 (robots versions, web vitals, render diffs, work items, crawler
hits, log ingestions) authored directly, then three disjoint workstreams.

### `b2cf7a9` — matrix + work queue

Category × competitor matrix DERIVED from recorded SERP observations (stores
nothing). Four states, never a boolean; category sample sizes count
observations that matched no tracked competitor so "we looked and found
nobody" cannot collapse into "we never looked". SEO work queue closes
observation → … → outcome; DONE requires a measured outcome (use case AND
CHECK constraint).

### `9d52981` — robots governance, CWV, raw-vs-rendered, server logs

Versioned robots.txt with line diff, two-person approval, transactional
publish-supersede and rollback-as-new-version. Lab and field vitals never
mixed. Render verdict is UNKNOWN when nothing was rendered. Crawler
verification by reverse-DNS + forward confirm; a user agent is a claim.

### `256b344` — hostile-review remediation

An adversarial review found nine real defects; all fixed. The three that
mattered most: an SSRF hole in the render-diff fetcher, an OAuth callback that
could never authenticate (dead control), and lifecycle decisions that were
recorded but never applied to the live product URL. Details in the commit body.

## PRODUCTION RELEASE — 2026-08-13

Release-controller run. Candidate `375d109` frozen, proven, released and
verified against production.

### Candidate identity (proven end to end)

```
LOCAL_HEAD=375d109  LOCAL_TREE=2d0f52b
ORIGIN_HEAD=375d109 (fast-forward, no force-push)
PROD_CHECKOUT_TREE=2d0f52b  ← identical to LOCAL_TREE
COMMITS_RELEASED=7 (handoff claimed 6; 2dd6f10 was also unpushed)
SECRET_SCAN=clean · no stray/generated files · no debug residue
```

### ZeroSkipGate closure

Closed against a production-shaped isolated environment on the release host
(never against live production data, never exposing secrets):

```
INTEGRATION_FILES=39   PASSED=38   TESTS=175/184
REMAINING_FAILURE=AnalyticsReadRepository.integration.test.ts
```

That one failure is **pre-existing, not a regression** — proven by running the
identical test against a from-scratch **8af8186** schema, where it fails the
same way. Its `beforeAll` truncates `products` without including
`product_prices`, whose FK exists in the pre-tranche schema too.

From-scratch migration of the candidate was also proven deterministic (3/3
`REHEARSE_OK`); an earlier one-off failure was a botched drop/create in the
harness, not a migration defect.

### Migration path

```
PRE_DEPLOY_CEILING=1789509600000 (journal 0117)
0118 / 0119 / 0120 = NOT_APPLIED -> APPLIED
FINAL_CEILING=1789603200000 (journal 0120)
LEDGER_ROWS 124 -> 127
CLASSIFICATION=EXPAND_ONLY / BACKWARD_COMPATIBLE
  16 CREATE TABLE + 22 CREATE INDEX; zero ALTER/DROP/TRUNCATE/UPDATE/DELETE
NEW_TABLES=16/16   SEO_CHECK_CONSTRAINTS=63
DATA_PRESERVED=orders 23 · products 8 · users 6 · competitors 57 -> 59
```

Rehearsed first on an ephemeral clone restored from the verified backup
(`REHEARSE_OK`), then applied live. The **old** application ran cleanly on the
expanded schema before the roll (0 errors), confirming backward compatibility.

Pre-existing ledger observation: production carried 124 applied rows against
118 journal entries at `8af8186` — historical journal compaction. All 124 are
distinct and none is newer than idx 117, so drizzle's forward decision was
unaffected. Recorded, not "fixed".

### Recovery point

```
BACKUP=/opt/goldplus/backups/pre-seo-tranche2-20260813-074227.dump (22,855,956 B)
SHA256=85e4413d4e36b90862b0b04d2629a728f998fb593c5eb2e6234850df8cba3863
VERIFIED=PGDMP magic · pg_restore --list exit 0 · 1675 TOC entries · 302 table-data
PRE_DEPLOY_API_IMAGE=sha256:9e921a83aaa0   PRE_DEPLOY_WEB_IMAGE=sha256:4f247eb569f9
PRE_DEPLOY_SCHEMA_FINGERPRINT=2f5974c623b971e955a27bcb7642ecab
ROLLBACK_CLASS=APPLICATION_ONLY_SAFE — the six new tables are invisible to the
  old app, so the artifact can be rolled back with the schema left expanded.
  No database restore is implied by an application rollback.
```

### Released artifacts

```
API_IMAGE=sha256:0ca71ee79684 (built 2026-08-13T07:57:10 from 375d109)
WEB_IMAGE=sha256:8dc9ee78e4a5 (built 2026-08-13T07:58:26 from 375d109)
```

### Competitor reseed (treated as a data migration)

Proven twice on the clone before production: run 1 changed 57 -> 59, run 2 left
count and content fingerprint **identical** (`69dc3393…`). Applied live with the
same result. MoMo Market = `REGIONAL_MARKETPLACE` / `isMarketplace=true`;
RedSMS Uganda and Kampala Arcade present as `UNRESOLVED`; Ayne Uganda retained;
zero duplicates.

### Production verification

Storefront, sitemaps, local pages, hubs, battery finder, PDP: all 200.
Every new public API endpoint 200. All six new admin API routers **401**, all
twelve new admin pages **303** to login with correct return targets.

Evidence gating held in production — truth was not traded for coverage:

```
/power /audio                                   indexable (gates pass)
/storage /phone-batteries /computer-accessories
/car-accessories                                noindex,follow (gates fail)
/battery-finder                                 noindex,follow (0 verified fits < 5)
sitemaps/hubs.xml                               only /power /audio + the two local pages
robots.txt                                      X-Robots-Source: STATIC_FALLBACK (nothing published yet)
/seo/product-lifecycle                          {"decided":false,"outcome":null}
/seo/battery-finder?q=samsung galaxy s21        {"matches":[],"verifiedCount":0,"indexable":false}
```

The OAuth callback returns **303, not 401** — the dead-control defect is fixed
in production.

### Commerce regression check

Homepage, /shop, /product-finder, /compare, /support, /track-order, /loyalty,
/returns, cart 200; checkout and account 303 to auth; a real PDP 200 (the route
carrying the new lifecycle lookup). No regression. Web errors 0, schema-mismatch
errors 0.

### Pre-existing production defect found during release observability

`RecommendationMaterializer` fails its repeat job with
`PostgresError: cannot cast type record to jsonb`
("Recommendation pre-computation failed"). It last changed on 2026-08-06
(`868ce36`) and is **untouched by this release** (0 files changed in the
candidate; the only `QueueWorkers.ts` change is an additive `seo-integration-sync`
branch). Not caused by, and not blocking, this release — but it is a live
failing cron that deserves its own fix.

Also pre-existing: `sgtm-preview` and `sgtm-production` containers are in a
restart loop, unchanged from before the release.

## ACTIVATION & CLOSEOUT — 2026-08-13

Activation-controller run against the production-verified release. No rebuild,
no redeploy, no new migration, no new release.

### Release identity reproduced (no drift)

```
LOCAL_HEAD = ORIGIN_HEAD = PRODUCTION_HEAD = 0dab2c4
api sha256:0ca71ee79684 · web sha256:8dc9ee78e4a5
MIGRATION_CEILING=1789603200000 (0120)
```

### Provider registry bootstrapped

The registry was empty in production. Bootstrapped via the existing
`RegisterSeoIntegrationProvidersUseCase` (manifest registration only, no
credential mutation, idempotent): **14 manifests, 14 unique, 0 duplicates**.

This is **not** an operations gap: `GET /admin/seo/integrations/providers`
calls the same use case on every read, so the first authenticated admin view
would have bootstrapped it anyway. This run simply pre-warmed it.
`BOOTSTRAP_STATE=GREEN_ACTIVATED`.

### Providers fail honestly (runtime-proven, no credentials involved)

Each Google adapter was asked to test its connection with **no** credential.
Every one returned a typed, provider-specific code — none fabricated success,
none collapsed into a generic "API unavailable":

```
google-search-console    INVALID_CREDENTIAL   "No credential configured."
google-analytics-4       INVALID_CREDENTIAL   "No credential configured."
google-merchant-center   INVALID_CREDENTIAL   "No credential configured."
google-business-profile  AUTH_EXPIRED         "Authorization required — complete the Google OAuth flow."
google-pagespeed         INVALID_CREDENTIAL   "No API key configured."
google-crux              INVALID_CREDENTIAL   "No API key configured."
```

PageSpeed/CrUX report a missing key rather than emitting zero measurements.
`FABRICATED_MEASUREMENTS=false`.

### OAuth boundary semantics (not just status codes)

```
OAUTH_START unauthenticated      401 — correct; initiation belongs behind admin auth
CALLBACK missing state           303 -> /admin/seo/integrations?oauth=invalid_state (rejected)
CALLBACK forged state            303 -> same rejection path (signature check holds)
FORGED_STATE_ACCEPTED=false      OAUTH_STATE_VALIDATION=GREEN
```

The callback is public by necessity (a browser redirect carries no Bearer
header) but authenticated by the HMAC-signed, single-use, TTL-bound state.

### Robots source settled

`seo_robots_versions` holds **0 rows**, so nothing has been published. The
storefront is designed to serve its committed static content until a governed
version is published, and it announces which source is live via
`X-Robots-Source`. Static fallback is therefore the **intended** state, not a
defect: `ROBOTS_STATE=GREEN_SAFE_FALLBACK`. It was left alone.

### Search truth unchanged by activation work

```
/power /audio                                   indexable
/storage /phone-batteries
/computer-accessories /car-accessories          noindex,follow
/battery-finder                                 noindex,follow
sitemaps/hubs.xml    /power /audio + the two local pages only
```

### RecommendationMaterializer — impact established

```
CURRENTLY_FAILING=yes
CANONICAL_SCHEDULE=0 * * * *  (HOURLY — not daily)
ATTEMPTS_PER_RUN=3 with backoff (observed 08:00:00, 08:00:05, 08:00:15)
ERROR=PostgresError: cannot cast type record to jsonb
recommendation_materialized_cache: 21 rows, last updated 2026-08-06 21:00:00Z
```

The cache froze on **2026-08-06**, the same day `RecommendationMaterializer`
last changed (`868ce36`). It has therefore been failing hourly for ~7 days —
long before this tranche existed, and the file is untouched by the release.

Customer impact is **stale, not absent**: live probes return real
recommendations (`product_related` 8, `home_trending` 12, `cart_addon` 6).

```
DATA_INTEGRITY_IMPACT=none (derived cache only)
PRICING / INVENTORY / CHECKOUT / SECURITY IMPACT=none
FAILURE_CONTAINED=yes   FALLBACK_PATH_EXISTS=yes
LAST_GOOD_DATA=2026-08-06 21:00Z   STALE_DATA_RISK=grows with catalogue churn
SEVERITY=SEV3
SCOPE=SEPARATE_PLATFORM_DEFECT — deliberately NOT repaired inside this closeout
```

SEV3 because a non-critical derived capability is degraded but still serving,
the failure is contained to one cron, and nothing touches money, stock, auth or
stability.

### Hygiene

Two diagnostic scripts (`/tmp/bootstrap-providers.ts`, `/tmp/probe-providers.ts`)
and four scratch files were used and removed. They were bind-mounted read-only
into `--rm` containers, so no image or application path was modified. Verified
after cleanup: repo clean, 1 worktree, no files under `apps/api/`, no secrets in
any scratch file. Backup retained.
`UNINTENDED_DIAGNOSTIC_RESIDUE=NONE`.

## Current state

```
STATUS=PRODUCTION_VERIFIED · NOT ACTIVATED (external configuration outstanding)
RELEASE_ID=375d109 (docs at 0dab2c4)
PROVIDER_REGISTRY=14 manifests registered
GSC / GA4 / MERCHANT_CENTER / PAGESPEED / CRUX = CONFIGURATION_REQUIRED
GBP = AUTHORIZATION_REQUIRED
ROBOTS_STATE=GREEN_SAFE_FALLBACK
INDEXABILITY_GATING=GREEN   SITEMAP_GATING=GREEN
COMMERCE_REGRESSION=NONE
ANALYTICS_TEST_DEFECT=PREEXISTING_TEST_DEFECT (carried forward, not green)
RECOMMENDATION_MATERIALIZER=SEV3, separate platform defect
PROGRAMME_STATE=WAITING_FOR_OWNER_CONFIGURATION
```

### Owner actions (the only things blocking activation)

1. `SEO_OAUTH_REDIRECT_BASE=https://shopgoldplus.com` in
   `/opt/goldplus/app/goldplus-commerce/.env.production` — not a secret;
   requires an api restart to load.
2. `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the same file —
   secrets; never paste them into a chat session; api restart to load.
3. Register the redirect URI in the Google Cloud console exactly as
   `https://shopgoldplus.com/seo/oauth/google/callback`.
   This session has no authenticated Google Cloud access and cannot do it.
4. Optional: `GOOGLE_PAGESPEED_API_KEY` to enable Core Web Vitals ingestion.

After 1–3, an administrator connects GSC/GA4/Merchant/GBP entirely from
`/admin/seo/integrations` with no redeploy. Service-account providers
(GSC/GA4/Merchant) need no env change at all — their credentials go straight
into the vault from the admin UI.

### Separate backlog item (not SEO/AEO)

`RecommendationMaterializer` hourly cron: `cannot cast type record to jsonb`,
failing since 2026-08-06, cache frozen, SEV3. Own work item after this closeout.
