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

## Current state

```
STATUS=PRODUCTION_VERIFIED (SEO/AEO release) · NOT ACTIVATED (see blockers)
HEAD=375d109  ORIGIN_HEAD=375d109  PRODUCTION_HEAD=375d109
MIGRATION_CEILING=1789603200000 (0120)
RELEASE_ID=375d109 / api sha256:0ca71ee79684 / web sha256:8dc9ee78e4a5
BACKUP_ID=pre-seo-tranche2-20260813-074227.dump
GREEN_GATES=unit+architecture 6353/404 · astro build · integration 175/184
  (1 pre-existing failure) · rehearsal REHEARSE_OK · live migration proven
  from DB truth · production smoke passed
CURRENT_PHASE=released and verified; awaiting external activation
```

### External blockers — owner action required, not engineering work

Every integration is honestly `NOT_CONFIGURED`. The control plane exists so an
administrator supplies credentials from the admin UI without touching `.env`,
Docker Compose or source, and without a redeploy. Two things, however, are
environment-level and cannot be set from the UI:

1. **Google OAuth** — `SEO_OAUTH_REDIRECT_BASE`, `GOOGLE_OAUTH_CLIENT_ID` and
   `GOOGLE_OAUTH_CLIENT_SECRET` are all absent from `.env.production`, and the
   redirect URI must be registered in the Google Cloud console as
   `<SEO_OAUTH_REDIRECT_BASE>/seo/oauth/google/callback`
   (with the current domain: `https://shopgoldplus.com/seo/oauth/google/callback`).
   `GOOGLE_OAUTH_STATUS=EXTERNAL_CONFIGURATION_REQUIRED`.
2. **PageSpeed/CrUX** — `GOOGLE_PAGESPEED_API_KEY` (or `GOOGLE_API_KEY`) absent.
   Without it the vitals sync returns `CONFIGURATION_ERROR` and stores nothing
   rather than fabricating a measurement.

`SEO_CREDENTIAL_VAULT_KEY` is absent but `JWT_SECRET` is present, so the
credential vault is operational on its documented fallback.

### Exact next action

Owner: set the OAuth env vars + register the redirect URI, and optionally add a
PageSpeed key. Then an administrator can connect GSC/GA4/Merchant/GBP/PageSpeed/
CrUX entirely from `/admin/seo/integrations` with no redeploy.

Engineering: the pre-existing `RecommendationMaterializer` jsonb-cast failure is
the highest-value unrelated defect now visible in production.
