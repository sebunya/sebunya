# Recommendation subsystem — R3 programme reconciliation matrix

Date: 2026-08-06 · Branch `claude/amazon-grade-goldplus-commerce-os-v5-production-20260802` · HEAD at reconciliation `5cec0e7` · Production release SHA `5cec0e7` (built from `/opt/goldplus/app/goldplus-commerce`), rollback SHA `df78cbd`.

This is the read-only reconciliation required before any R3-programme code change. Every row was verified against live source, the production database, and the live storefront/API on 2026-08-06 — not inferred from the admin UI.

## The three findings that reframe the brief

**F1 — The storefront recommendation experience is empty because the web tier vetoes the entire live catalogue.**
`apps/web/src/lib/catalog/catalog.ts:741` (`STALE_SLUGS`) blocklists all eight product slugs that exist in the production database. Every rail's display boundary (`recommendation-display.ts:170`) rejects every live product with "Safe PDP slug is missing", so every recommendation surface renders its empty state, on every page, for every visitor — while `/shop` and the PDPs happily sell those same eight products. Landed 2026-07-21 (`13633d8`, "restore catalogue data-plane parity") expecting a catalogue swap that never happened; rail decay began 2026-05-22 (`f69aa6e`). Alongside it sits `LOCAL_SEED_PRODUCTS`: ~16 fabricated GoldPlus-branded products with invented UUIDs, invented prices and invented `in_stock quantity 100` availability, hardcoded in the web bundle as a render-path fallback — a direct violation of the no-invented-facts rule. The API engine itself serves correctly (verified live: `GET /recommendations?placement=home_trending` returns scored items with attribution IDs).

**F2 — Rail events died with the rails, not with the pipeline.**
All 252 `RECOMMENDATION_IMPRESSION` / 7 CLICKED / 3 ADD_TO_CART events sit in one week (2026-05-18..22) and never recur; `PRODUCT_VIEWED`/`PRODUCT_ADDED_TO_CART` flow to this day. The write endpoint works (probe landed 2026-08-06, marked `metadata.probe=r3-reconciliation`, anon `anon_r3probe0000001`). Empty rails → no cards → no impressions. The admin claim "placement unknown = 49" is an analytics classification artifact: NULL-placement page-level events (PRODUCT_VIEWED etc.) counted into an "unknown" bucket at `DrizzleRecommendationAnalyticsRepository.ts:60`; rail events always carried valid placements.

**F3 — The identity net exists and was never hung up.**
`identity_links` (schema/identity.ts:122) has exactly the right columns and no writer anywhere; the admin Identity Health panel divides by it and shows 0% forever. Two client-generated ID namespaces (`goldplus_anonymous_id` localStorage; `_fp_cid` JS cookie) never reconcile with each other or with `goldplus_session`. The SSR rail fetch cannot even send an anonymous ID (`getAnonymousId()` is null on the server). `customerId` on the public events endpoint is client-asserted and only format-checked. Experiments (`deterministicVariant`, unique-indexed assignment/exposure tables) are complete and unreachable from any storefront path.

## Production data reality (2026-08-06)

- Catalogue: **8 products**, 3 categories, all active+approved, all priced, all genuinely in stock (stock 25–200, reserved 5 across 3 products). The `LOCAL_SEED_PRODUCTS` catalogue exists nowhere in the database.
- `recommendation_events`: 346 rows (2026-05-19..2026-08-06). Rail events: one week in May only. Identity: 20 distinct `anonymous_id`, **zero** session/customer/browser IDs ever recorded.
- `recommendation_rules`: 0. `recommendation_materialized_cache`: 21 rows, refreshed hourly (13:00Z today) — the hourly materializer cron **is** live, so virtually every live request is served from the cache-first path. Cache `items` is double-encoded (JSON string inside jsonb).
- Search signals: `search_demand_signals` 3, `search_product_insights` 1, `ug_search_miss` 21 — aggregate-only, deliberately identity-free.
- `experiments`/`assignments`/`exposures`: 0. `identity_links`/`customer_identity_links`: 0. Paid orders: 0 (co-purchase sources must report INSUFFICIENT_SAMPLE honestly).
- Compatibility: `product_compatibility_mappings` 0, `product_device_compatibility` 0, `devices` 0 — exact-compatibility sources are data-empty; the regex `ProductSignalExtractor`/`CompatibilityRuleService` heuristics are the only working compatibility signal.
- Env truth: `RECOMMENDATION_V2_RULES_ENABLED` is read inline in the use case, absent from the api container (compose env allowlist doesn't pass it) → rules OFF in production. `RECOMMENDATION_MATERIALIZER_RUNTIME_ENABLED=0` in `.env.production` is a dead knob — nothing reads it.
- Live page truth: PDP rails render empty states; homepage has recently-viewed (hidden, `always-render=false`, can never show — `goldplus_seen_before` has no writer) and a dead `CategoryAwareRail` (reads two localStorage keys nothing writes, embeds the full catalogue JSON in HTML); cart has no addon rail visible; `GTM-MOCKID` mock loader ships on every live page.

## The matrix

Format per row: REQUIREMENT → CURRENT_CAPABILITY / CANONICAL_OWNER / SCHEMA / ROUTE / EVENT / TEST / PRODUCTION_PROOF / WEAKNESS / CLASSIFICATION / TRUE_GAP / CHOSEN_ACTION.

### 1. Canonical engine & pipeline
- CURRENT_CAPABILITY: `GetRecommendationsUseCase` (cache-first → V1 generate → V2 rules → dedup → diversity → fallback), 9 injected services, single write path for responses.
- CANONICAL_OWNER: `apps/api/src/application/recommendations/GetRecommendationsUseCase.ts` — **this remains the one engine**.
- CURRENT_ROUTE: `GET /recommendations` (public, no rate-limit family of its own). CURRENT_TEST: cache branch only; execute() past cache untested.
- CURRENT_PRODUCTION_PROOF: serves live (verified 2026-08-06); trailing-slash variant 404s.
- CURRENT_WEAKNESS: no request/response events; strategy string always `rule_based_v1` (lies under rules/fallback); silent catch on cache and rules failures; `limit` unbounded (`NaN` flows through); `error.message` echoed to public on 500.
- CLASSIFICATION: partial. TRUE_GAP: stages 1,4,7,9,12,13,14 of the 14-stage contract. CHOSEN_ACTION: **HARDEN** in place (R3) — explicit stage structure, versioned policy, explanation payload, server-side response events, bounded inputs, observable degradation. No second engine.

### 2. Candidate sources
- CURRENT_CAPABILITY: exactly one source — unordered `findPublicProducts` (approved+active, LIMIT, **no ORDER BY**), category-scoped or global per placement.
- CURRENT_WEAKNESS: no behavioural, order-derived, search-derived, compatibility-table or quality sources; non-deterministic ordering; `TrendingScoreService` weighted sums treated as ranks, `getTrendingEvents` LIMIT without ORDER BY.
- CLASSIFICATION: BUILD_GAP_ONLY. TRUE_GAP: explicit named sources with per-source state (SUPPORTED / SUPPORTED_WITH_LIMITATIONS / INSUFFICIENT_SAMPLE / STALE / UNSUPPORTED / DEGRADED) and bounded queries: velocity (view/ATC/paid-order), bestseller (order_items), co-cart/co-purchase (honest INSUFFICIENT_SAMPLE at current volume), search affinity (`search_product_insights`), exact compatibility (tables exist, empty → INSUFFICIENT_SAMPLE), catalogue-quality, new-and-eligible, curated (ACTIVE PIN rules), deterministic fallback (stable ORDER BY). CHOSEN_ACTION: BUILD inside the canonical engine (R3).

### 3. Eligibility
- CURRENT_CAPABILITY: SQL layer enforces approved+active; in-memory layer string-infers stock (`isInStock` defaults **true** when unknown), checks slug/image/self/cart/category; `isVisible` hard-coded true and `isFeatured` hard-coded false in `mapProduct` (dead checks/components).
- CANONICAL_OWNER of truth being bypassed: `products.stock_quantity`/`reserved_quantity` (RESERVE-1), `product_prices.retail_price`.
- CLASSIFICATION: HARDEN. TRUE_GAP: available-to-promise (`stock−reserved>0`) and valid-price (`retail_price>0`) enforced from canonical columns at candidate SQL; remove dead flags honestly. CHOSEN_ACTION: HARDEN (R3). Rules can never bypass (already true — rules re-run eligibility; preserve).

### 4. Rules engine (boost/pin/suppress)
- CURRENT_CAPABILITY: SUPPRESS→PIN→BOOST over target_type/value, fails closed on conflict, re-runs eligibility after application, per-rule audit trail table.
- CURRENT_WEAKNESS: `conditions` entirely unevaluated (admin can save dead config); `priority` not honoured within type; `PAUSED`/`EXPIRED` unreachable via validator; `BRAND`/`PLACEMENT_OVERRIDE` declared but dead; `MERCHANDISING_BOOST` force-stamped onto organic items; env flag `RECOMMENDATION_V2_RULES_ENABLED` not passed to prod container.
- CLASSIFICATION: KEEP semantics + HARDEN. TRUE_GAP: honest vocabulary (drop or implement dead members), priority within type, schedule expiry, flag resolved so prod behaviour is deliberate. CHOSEN_ACTION: HARDEN (R1 flag + vocabulary honesty; R5 governance).

### 5. Placement registry
- CURRENT_CAPABILITY: 6 IDs (`product_related`, `complete_setup`, `cart_addon`, `home_trending`, `category_popular`, `recently_viewed`) in `packages/shared/src/recommendations.ts`, **triplicated** as runtime arrays in two API files.
- CLASSIFICATION: KEEP IDs (preserved verbatim), HARDEN single-sourcing. CHOSEN_ACTION: one exported registry consumed by all three sites (R1). No new placement vocabulary.

### 6. Event contract & producers
- CURRENT_CAPABILITY: 25-type vocabulary; rich 44-column `recommendation_events`; validation (PII-key blocklist, UUID shape, anon format); app-level dedup windows (SELECT-then-INSERT race); browser-only emission, cross-origin, identity client-asserted.
- CURRENT_WEAKNESS: no DB idempotency; phantom `RECOMMENDATION_CLICK` in four analytics queries; no schema/producer version; no server-native request/response facts; `RecentlyViewedRail` fabricates non-UUID attribution ids; unauthenticated `customerId`.
- CLASSIFICATION: HARDEN (one vocabulary, evolved). TRUE_GAP: `RECOMMENDATION_RESPONSE`/`RECOMMENDATION_DISMISSED`/`RECOMMENDATION_ERROR` types; `dedupe_key` unique index (migration); schema_version/producer stamps; server-side response emission; same-origin relay stamping identity server-side. Historic rows preserved untouched (HISTORIC_UNKNOWN). CHOSEN_ACTION: R1 (contract) + R2 (producers).

### 7. Storefront rails
- CURRENT_CAPABILITY: 4 rails SSR-rendered (good bones: server-first paint already exists); RecentlyViewed hybrid-hidden; CategoryPopularRail unmounted; CategoryAwareRail dead; every rail's fallback re-fetches `/products?limit=50` and re-ranks through a **third engine** (`recommendation-display.ts` ladder) that currently vetoes everything (F1).
- CLASSIFICATION: KEEP SSR shape; **DEPRECATE_WITH_PROOF** the client-side selection engine + STALE_SLUGS + LOCAL_SEED_PRODUCTS (retirements named; Slice06F pins rewritten to the server contract). TRUE_GAP: rails trust the canonical API result (which gains a real fallback ladder), render honest copy per evidence level, emit impressions/clicks via same-origin relay. CHOSEN_ACTION: R1 removes the veto path (storefront un-empties with the real catalogue); R7 completes UX/copy/counts.

### 8. Session, identity & continuity (server-first §5A)
- CURRENT_CAPABILITY: no server-side visitor identity; localStorage `anon_*`; signed cart credential (server-minted, basket-scoped) proves the HttpOnly pattern works here; `goldplus_session` for authenticated; `identity_links` unwired; Customer DNA merge discipline exists admin-side (`STABLE_ANONYMOUS_ID` is an approved signal).
- CLASSIFICATION: BUILD_GAP_ONLY on existing owners. TRUE_GAP: opaque HttpOnly visitor locator → server `experience profile` (Postgres canonical, 180-day continuity), SSR context resolution, login merge writing `identity_links` + DNA signal (transactional, idempotent, weaker-never-overwrites-stronger), event identity stamped server-side. CHOSEN_ACTION: R2. No second identity graph: `identity_links` is the join table, Customer DNA stays the resolution authority.

### 9. Same-origin delivery path
- CURRENT_CAPABILITY: browser → `https://api.shopgoldplus.com` direct with CORS; no storefront proxy; MEASURE-1 same-origin allowlisted proxy pattern already proven for admin measurement pages.
- CLASSIFICATION: BUILD_GAP_ONLY (replicate proven pattern). TRUE_GAP: same-origin `/api/rec/*` relay on the web app for events (+ cart-addon fetch), attaching the HttpOnly locator server-side. Public API routes stay compatible for cached pages. CHOSEN_ACTION: R2.

### 10. Frequency, recency, fatigue
- CURRENT_CAPABILITY: none (WeakSet in-page impression dedup only).
- CLASSIFICATION: BUILD_GAP_ONLY. TRUE_GAP: recently-recommended/recently-purchased penalties as versioned deterministic policy components (default-on, policy-versioned); operator caps (exposure/session/day, cooldowns) via closed ops-config registry, **unset = off** (payments discipline). CHOSEN_ACTION: R3 (penalties) + R5/R6 (config surface).

### 11. Search ↔ recommendation convergence
- CURRENT_CAPABILITY: search demand/insight/miss aggregates exist and are identity-free by design; `PRODUCT_SEARCHED` event + `search_query` column never written; no affinity reader.
- CLASSIFICATION: BUILD_GAP_ONLY via governed interface. TRUE_GAP: `SearchAffinityReader` port over canonical search tables (no ownership merge); profile-side recent-search context captured server-side at search time; zero-result rescue; admin search-intent panel. CHOSEN_ACTION: R4.

### 12. Analytics & admin
- CURRENT_CAPABILITY: real analytics service with honest touches (min-denominator guard exists at depth level; unavailable-metrics honesty) but: phantom event type, `activeProducts` denominator counts drafts, identity link rate relates unrelated populations, marketing-fiction placement descriptions on the overview, preview/new-rule pages serialize the **internal** api origin into HTML (broken in prod), raw-UUID-only inputs.
- CLASSIFICATION: HARDEN + partial REPLACE (pages rebuilt on server-native facts). CHOSEN_ACTION: R5 (rules/preview UX + governance), R6 (analytics/overview/action centre).

### 13. Experiments & model readiness
- CURRENT_CAPABILITY: complete deterministic assignment machinery (FNV-1a bucketing, unique-indexed, idempotent exposures), admin-only, zero storefront path, zero experiments. No model, no shadow, no readiness statement.
- CLASSIFICATION: KEEP owner; BUILD_GAP_ONLY the storefront-side assignment via profile subject hash + readiness surface + shadow scaffolding that cannot touch responses. No activation without explicit approval. CHOSEN_ACTION: R8.

### 14. Observability & performance
- CURRENT_CAPABILITY: none recommendation-specific (no metrics, no tracing, silent catches); p95 unknown; cache-first path hides engine cost; materializer runs ~1000 serial pipeline passes hourly on the shared ANALYTICS_FANOUT queue and prunes an unrelated telemetry DLQ.
- CLASSIFICATION: BUILD_GAP_ONLY + HARDEN materializer (bounded, deterministic, observable; TTL-stamped upsert). CHOSEN_ACTION: R3/R6; performance evidence in R9.

### 15. Product-finder engine (ruled: not a duplicate to destroy)
- `ProductFinderRecommendationEngine` is a separate in-memory ranker for the guided quiz surface with its own vocabulary. It is **not** a placement engine and predates this programme. CLASSIFICATION: KEEP (recorded debt: eligibility semantics should converge on canonical availability — it already uses `availableQuantity`, closer to canon than the rail engine). No merge in this programme; documented so nobody "unifies" it into a second placement path.

### 16. Consent & compliance posture (§32)
- CURRENT_CAPABILITY: consent SDK unimported; no banner (correct per §5A.12 — no banner is desired for essential first-party); GTM/PostHog load unconditionally with mock defaults (`GTM-MOCKID` live today); recommendation evidence already first-party.
- CLASSIFICATION: HARDEN quietly. TRUE_GAP: third-party loaders gated on real configuration (no mock IDs in prod HTML); no raw locator in logs; recommendation path requires no third-party dependency (already true — keep it provable). CHOSEN_ACTION: R7, minimal and invisible.

### 17. RBAC
- CURRENT_CAPABILITY: all 10 admin recommendation routes behind blanket `settings.manage` ("temporary RBAC compromise" per docs/recommendation-engine-v2.md); `RECOMMENDATIONS_READ`/`RECOMMENDATIONS_MANAGE` exist in the shared vocabulary, unused.
- CLASSIFICATION: HARDEN. CHOSEN_ACTION: R1 — reads behind READ, mutations behind MANAGE, no new strings needed.

## Migration plan (ceiling 0098 → new: 0099+, additive, reversible, rehearsed on a restored clone before live)
- 0099: event-contract hardening — `dedupe_key` + partial unique index, `schema_version`, `producer` columns on `recommendation_events`; `profile_id` uuid + index.
- 0100: `experience_profiles` (opaque-token hash → profile) + continuity fields.
- 0101: `recommendation_ops_config` closed registry (payments discipline, all unset = off).
- (If needed) 0102: materialized-cache TTL/upsert support (`expires_at`, unique `(placement, context_key)`); dedupe existing 21 rows first (currently 0 duplicates).

## Stop conditions carried from the brief
- Payments programme stays closed; `PAYMENT_REAL_PIN_SUCCESS_PROOF=EXTERNAL_OPERATOR_ACTION`.
- The catalogue CONTENT question (8 demo-flavoured products vs the intended GoldPlus range in `LOCAL_SEED_PRODUCTS`) is a **product-data import decision owned by the operator** (docs/product-data-import-plan.md). This programme makes the system truthfully recommend whatever the canonical catalogue contains; it does not invent or import products.
- No experiment activation without explicit approval. Do not merge PR #9. No force-push. No destructive load tests against production.
