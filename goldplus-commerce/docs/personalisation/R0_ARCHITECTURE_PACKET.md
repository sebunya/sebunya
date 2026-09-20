# Personalisation & Telemetry Rebuild — R0 architecture packet

Status: **awaiting independent review**. No semantic change ships before this
packet is adjudicated (contract §68).

## 1. Measured pathology (2026-09-20)

- 780,935 experience profiles; 99.95% seen exactly once; 390 returned; 7 linked to customers.
- ~95% of `recommendation_events` rows are `RECOMMENDATION_RESPONSE`; 3 clicks in 7 days.
- Volume flat over 24 h (~5,400 events/h at 03:00). Sampled `/recommendations`
  requests: 100% `User-Agent: node`, internal address.
- `recommendation_events`: 924 MB heap + 422 MB indexes, upd=0 del=0 (append-only).
- `experience_profiles`: live mutable serving state (815k updates, 43k deletes).

## 2. Exact call graph — where READ becomes WRITE

```
browser/bot/crawler document request
  └─ apps/web/src/middleware.ts:141   no valid gp_visit cookie → mintSignedVisitToken()
        (sets locals.gpVisit AND locals.gpVisitIsNew = true)
  └─ SSR page (index/shop/PDP/cart/login/register) → GET /recommendations, header x-gp-visit
        └─ routes/recommendations.ts:135  resolveExperienceProfileUseCase.execute(token)
              └─ ExperienceProfileUseCases.ts:82  profiles.resolveOrCreate(tokenHash)
                    └─ DrizzleExperienceProfileRepository.ts:13  INSERT … ON CONFLICT DO UPDATE   ← WRITE #1
        └─ getRecommendationsUseCase.execute(…, { emitResponseEvent: true })
              └─ GetRecommendationsUseCase.ts:639  save RECOMMENDATION_RESPONSE                   ← WRITE #2
```

`SyntheticMonitor.ts:480` calls `GET /recommendations` with no `x-gp-visit`:
no profile, but WRITE #2 still fires on every probe.

**Root cause, precisely:** the middleware mints a token for every cookieless
document request, and SSR forwards that *just-minted* token as if it were a
stable identity. A client that never returns the cookie (every bot, crawler,
link preview, Lighthouse run) therefore creates one profile per page load.
`resolveOrCreate` is also reached from `nav.ts:20`, `hero.ts:23`,
`recommendations.ts:29` and `commerce.ts:612`.

## 3. Proposed design

### 3.1 A just-minted token is not a stable identity
`locals.gpVisitIsNew` already exists. SSR forwards `x-gp-visit` **only when the
browser presented a cookie we previously signed**. A returned cookie is proof of
a cookie-keeping client; no UA or IP heuristics are involved (Invariant 6).
First-page-load of a real visitor is served generic/contextual; their second
request is identified. Bots never return the cookie → zero profiles.

### 3.2 Reads resolve; only behaviour creates
Split the repository method:
- `resolve(tokenHash)` — SELECT only. Used by every GET path (recommendations,
  hero, nav).
- `resolveOrCreate(tokenHash)` — retained only on the behavioural-ingestion
  write path and checkout (`commerce.ts:612`), where a persistable identity is
  performing a meaningful action.
- Types: `Identity = user | visitor | none`; `PersistableIdentity` excludes
  `none`; `createProfile/recordBehavior` accept only `PersistableIdentity`.
- One `PersistencePolicy.evaluate({origin, identity, eventType, consent})`.

### 3.3 RESPONSE is an operational metric, not behaviour
`RECOMMENDATION_RESPONSE` stops being written to `recommendation_events`;
it becomes `recommendation_requests_total{origin,placement,outcome}` and
`recommendation_generation_seconds` in Prometheus. The admin "is the engine
serving" analytics (DrizzleRecommendationAnalyticsRepository:25–51) currently
reads those rows and must be re-pointed at the metric or a bounded
operational table before the write stops.

### 3.4 Synthetic monitor
Runs in the API process already: call the use case **directly** with
`origin: "synthetic_monitor"` (typed, not a header), which the policy denies
for profile and behaviour writes. No public header is trusted (§7).

### 3.5 Flags (granular, per §77)
`ssr_identity_v2`, `profile_read_pure`, `response_event_to_metric`,
`synthetic_no_persist` — each independently reversible.

## 4. Known risks / open questions for the reviewer

1. **First-visit personalisation loss**: a genuine new visitor's first page is
   generic. Acceptable? (Today that visitor has no history anyway.)
2. **Hero/nav on first request**: `gpVisitIsNew` drives welcome-vs-signup copy;
   must keep working without a profile row.
3. **Experiment assignment** (`recommendations.ts:143`) requires a profileId —
   first-request visitors fall out of experiments. Bias?
4. **Repetition penalties** rely on RESPONSE rows ("recently shown"). Does
   `findRecentlyShownProductIds` read RESPONSE events? If so, stopping the
   write changes ranking and needs a replacement signal (impressions v2).
5. **Cache/CDN**: are any SSR pages that embed personalised rails cacheable at
   Cloudflare/Caddy under a shared key? Must be audited before and after.
6. **Consent**: owner decision 2026-09-19 — server-side analytics always on;
   profile creation on returned-cookie is within that posture?
7. **Checkout** (`commerce.ts:612`) keeps create semantics — correct?
8. **Rollback**: flags off restores today's behaviour exactly; any state
   created under new semantics is a subset of old semantics (safe).

## 5. Not in scope of R0
Profile v2 / compact features, hero 90–180-day scan removal, event v2,
impressions v2, legacy cleanup. Each gets its own gate; **no historical row is
deleted until off-host restore + PITR are proven and R3 has passed.**

## 6. R0 adjudication (independent reviewer, 2026-09-20)

| # | Sev | Finding | Decision |
|---|-----|---------|----------|
| F2 | MAJOR | GET also writes experiment assignment+exposure (`recommendations.ts:143`) | ACCEPT — WRITE #3; only reached with a resolved profile, goes under PersistencePolicy |
| F3 | MAJOR | `shop.astro:100` SSR POSTs PRODUCT_SEARCHED with a just-minted token | ACCEPT — fixed by the source gate (F9) |
| F4 | MAJOR | Monitor's fetch of `http://web:4321` drives all SSR rails; typed origin can't cross the web hop | ACCEPT — fixed by 3.1 + 3.3, 3.4 only covers the direct call |
| F5 | NOTE | nav resolves only on POST; hero.ts:23 shared by GET and POST | ACCEPT — 3.2 corrected: hero GETs pure-read, POSTs create |
| F7 | **BLOCK** | `HeroSignalsService.visitStrength` counts distinct days over ALL events incl. RESPONSE | ACCEPT — filter to behavioural types ships BEFORE `response_event_to_metric`; a visit is something the visitor did, not something we rendered |
| F8 | MAJOR | serving-health needs `fallbackLevel`/`emptyReason`, metric labels drop them | ACCEPT WITH MODIFICATION — bounded hourly aggregate table flushed from memory, not Prometheus (admin reads the DB) |
| F9 | MAJOR | 8+ untypechecked call sites | ACCEPT — middleware exposes `locals.gpVisit` only for a returned cookie; login/register rotation explicitly exempt; guard test |
| F10 | MINOR | JS-running bots return the cookie on beacons | NEEDS EXPERIMENT — measure profiles/day after cutover |
| F11 | MINOR | no Cache-Control on GET /recommendations or documents | ACCEPT — `private, no-store` |
| Q8 | — | "rollback restores exactly" is false | ACCEPT — reworded: rollback is safe, not identical (RESPONSE gap, later first_seen_at) |

BLOCK F7 is resolved by ordering: the visitStrength filter is a prerequisite of the response flag.

## 7. Self-review of 1c38db53 and the external brief (2026-09-20)

Did the first commit close the causal loop or only reduce symptoms? **It reduced
them.** Three gaps remained and are fixed in 8b0dacfe / bd07895d:

| Gap | Why it mattered | Fix |
|---|---|---|
| Visit strength excluded ONE event name | impressions/views we emit when a rail renders still fed strength → rendering fed rendering | explicit `VISITOR_ACTION_EVENT_TYPES` (shared); a new type fails the build until classified |
| Counter dropped a batch on any DB error, never flushed on SIGTERM, could flush concurrently | health page would silently under-report | retain+retry failed buckets, 6 h outage cap with reported drops, single-flight, 3 s shutdown flush |
| 180-day profile prune + 180-day cookie | deletes history (violates invariant 8) and contradicts the owner decision "keep personalisation forever" | prune removed; cookie = 400-day browser cap, sliding daily; hero strength/affinity read whole profile history (profile_id-indexed) |

Owner decision recorded: **personalisation history has no time limit.**
"Forever" for an anonymous browser is bounded by the browser's 400-day cookie
cap; a signed-in customer's profile is permanent.

Rejected from the brief, with reason: a returned cookie is *not* treated as proof
of humanity here — it is only the condition for identity continuity; profile
creation still requires a visitor action. JS-running bots that POST events can
still create profiles (R0 F10) — measured after release, not guessed at.

Counter accuracy model: operational gauge. Loss ≤ one 60 s interval on kill/OOM;
possible double count of one bucket on a commit-then-timeout. Not used for
revenue, attribution or experiment conclusions.

First visit: page 1 is served generic; the cookie is set on that response, so
the first click/add-to-cart from page 1 already carries it through the browser
relays (`api/rec`, `api/hero/events`, `api/nav/events`) and creates the profile
with behaviour intent. Checkout/login/register keep create semantics.

## 8. Test evidence (commit bd07895d, `npx vitest run tests --maxWorkers=3 --minWorkers=1`)

8b0dacfe: 8,094 passed / 3 failed / 237 skipped. Two were introduced by this
work (PgParams boundary, 180-day cookie pin) and are fixed in bd07895d
(architecture + affected files: 134/134). `ZeroSkipGate` is environment-only
(no integration services on the workstation). Slice09 guards pass once the tree
is committed. `compatibility-audit/*` and `performance-audit/*` are Playwright/
node specs that vitest only collects when run from the repo root without the
`tests` path — not part of this suite. Real-Postgres integration for 0144 and
the hero query is NOT yet run (needs `scripts/integration-on-clone.sh` on the host).

## 9. Release (NOT executed — push and host copy are permission-blocked)

1. `git push`
2. `git archive HEAD | ssh goldplus-prod 'tar -x -C /root/itest-src'`
3. host: `scripts/integration-on-clone.sh` (abort on any failure)
4. host: `scripts/migrate-prod.sh <image> 0144 "select (count(*)=1)::int from information_schema.tables where table_name='recommendation_serving_hourly'"` — additive CREATE TABLE IF NOT EXISTS, no lock on existing tables, safe under the old app
5. host: `nohup ./scripts/deploy-prod.sh <sha> api web > /tmp/deploy-<sha>.log &`
6. Rollback: redeploy `rollback-340fb1f5`, or set any of `SSR_IDENTITY_V2` / `PROFILE_READ_PURE` / `RESPONSE_EVENT_TO_METRIC` to `false` and restart (restores the old pollution — a containment trade-off, not a safe state). The table stays; no data rollback is needed.

Thresholds (baseline: ~19–27k events/day, ~all profiles seen once): RESPONSE rows
written after deploy = 0; new profiles/day falls by >90% and every new profile
has ≥1 visitor-action event; event POST accept rate unchanged; checkout smoke
passes; `RECOMMENDATION_SERVING_STATS_FLUSH_FAILED` = 0. A fall in visitor-action
events is a FAILURE signal, not success.

## 10. States
code ready: YES (pending host integration run) · production authorized: NO ·
deployment verified: NO · observation complete: NO

## 11. Second-pass challenge (2026-09-20) — corrections and evidence

**Claims I made that were wrong, now corrected**
- "400 days is the longest browsers allow / forgotten only after 400 days": wrong as a guarantee. We REQUEST 400 days on a server-set, HttpOnly, Secure, SameSite=Lax, path=/ first-party cookie, renewed at most once a day on a document request (same token re-set — no new identity, no DB write). Chrome caps requests at 400 days; users, private windows and browser privacy rules can end it sooner. When the cookie is lost the server-side profile REMAINS; only a signed-in customer reconnects to it (`linkCustomer` on login/register).
- "A forced kill loses at most one minute": only with a healthy database. During an outage everything retained in memory (up to 6 h) dies with the process. Nothing is durable before it is written.
- "Can double-count one hour of one placement": understated — retries could compound. Now capped at 3 attempts per bucket per process, then dropped and logged.
- "Only one profile's rows" is not a bound. **Measured on production (read-only, 15 s timeout):** heaviest profile all-time = 891 rows (434 visitor actions); 7-day p50 = 1, p99 = 6, max = 151 across 125,520 profiles. The all-history aggregate is small today; revisit if any profile passes ~50k rows.

**Retention vs continuity vs ranking — now separate**
- Retention: profiles and events are never deleted (prune removed; the prune's past deletions — ~43k rows — are not recoverable and not claimed).
- Continuity: the cookie request above.
- Ranking: visit strength = lifetime relationship (distinct days with a visitor action; its tenure floor already made "regular" permanent before this work, so semantics are unchanged). Category affinity = current interest: all history, weight halves every 90 days, server clock, future-dated rows clamped.

**Provenance of events admitted to visit strength.** `PRODUCT_VIEWED` fires from browser JS on PDP load and `PRODUCT_SEARCHED` from SSR on `/shop?search=` — neither proves a human. Known automation that runs our JS (Lighthouse Watch and the rolling audits, UA `GoldPlusSyntheticProbe`; lab browsers that self-identify) is now dropped at the three event relays. Suppression-only, so spoofing it gains nothing. Undeclared JS-running bots remain a residual: watch new profiles/day vs visitor-action events/day after release. Incoming event types are runtime-validated (`isRecommendationEventType`); the classification test reads the authoritative shared vocabulary, not a copy.

**First visit (from code, not yet from a browser trace):** browser events go same-origin to `/api/rec/events` with `credentials: same-origin`; the relay reads the HttpOnly cookie itself and forwards it, so SameSite/API-origin do not apply and no SSR-provided token is needed. A controlled browser trace is a post-deploy check.

**Derived state.** Hero signals are computed at read time, so they correct themselves on deploy. No stored segment is rebuilt by this work.

**Tests — commit f24ac009**, `npx vitest run tests --maxWorkers=3 --minWorkers=1`: 8,101 passed, 1 failed, 237 skipped. The failure is `ZeroSkipGate` (asserts integration services exist; none on the workstation — a verification GAP, not a pass). The 237 skips are the 46 real-Postgres integration files gated on those services; they include the recommendation/profile integration tests, so the changed SQL (0144 upsert, hero queries) is unverified against a real database until the clone run. `performance-audit/tests/*.mjs` is a `node:test` file vitest mis-collects; unrelated to this change. `compatibility-audit` is Playwright against the live site — relevant only post-deploy.

## 12. Decisions per action
| Action | State |
|---|---|
| Push branch (no CI deploy is attached to this branch) | GO — needs the runtime permission |
| Copy `git archive` to `/root/itest-src` (staging dir, not the running tree) | GO — needs the runtime permission |
| `integration-on-clone.sh` on host (ephemeral PG container; check ≥1 GB free RAM first, abort otherwise) | GO after copy |
| Migration 0144 + deploy api/web | NO-GO until the clone run is green, then owner approval |
| Delete the ~780k render-minted profiles | NO-GO (no off-host restore proof; separate review) |
| 15 m / 1 h / 24 h / 72 h observations | NOT scheduled — runbook in §9 |

## 13. Credential incident (open)
- ZeptoMail send token: exposed in this session's transcript only (not in git). Rotation needs a Zoho console sign-in, which I must not perform. Owner: ZeptoMail → Mail Agents → the agent → SMTP/API → regenerate token; put the new value in the host env file as `ZEPTOMAIL_API_TOKEN`; tell me and I will restart the API and verify a send. Regenerating revokes the old token.
- Admin password: reached git history. Owner: change it in the admin account screen; I will then verify old sessions are invalid. Until both are done the incident is OPEN regardless of code status.

## 14. Consolidated brief — decisions and evidence (2026-09-20)

**What works / blocked / unverified / next**
- Works (verified existing, not new): recently-viewed + cart-aware rails on home; device cookie + fit badges on PDP/cart.
- Blocked by DATA, not code: fit badges — `devices`, `device_brands`, `product_device_compatibility` = 0 rows. The 80 battery profiles / 204 aliases describe batteries, not phones. Prepared: `device-compatibility/` (34 source-backed claims, validated, NOT applied; 68 held with reasons).
- Taxonomy: affinity keys on `categories.slug`; only 3 categories + Other exist, so shop ordering is COARSE (moves whole categories). Nav labels (Power/Sound/Storage/Car/PC) are collections, not stored categories. Not rebuilt here.
- Next increment chosen: "this phone?" suggestion on the battery finder — needs no mappings to be honest, and feeds the existing search.

**Shop ordering contract (as implemented):** whole catalogue is sorted BEFORE pagination (not a page reshuffle). Standard order when: first visit, no affinity ≥ 2, any query/filter/chosen sort, `?order=standard` (URL-scoped: survives paging, not a saved preference), `SHOP_PERSONAL_ORDER=false`. Page-1 lead categories ride in `lead=` so paging is stable; the value is only matched against the taxonomy. Ties: taxonomy → subcategory → name. Path creates no profile and emits no behavioural event (reads still cost one indexed query, 1.2 s timeout, generic fallback). Shared-browser caveat: affinity follows the browser cookie; login rotates the visit token (existing), so a second account does not inherit the first's browser profile.

**Browsing device:** UA-CH `model` (mobile only) or an unreduced Android UA → offered as a question on the finder. Reduced Chrome ("K"), iPhone, iPad, Mac, Windows, TV → no suggestion, generic finder. Nothing stored, nothing sent, no cache variance (client-side). Simulated UAs only — no real-hardware or TV evidence.

**Build/test evidence**
- Web: `tsc --noEmit` clean; `astro build` Complete (commit 3b18296a and after).
- Suite on the committed tree (3b18296a): 8,114 passed / 1 failed (`ZeroSkipGate`, environment) / 237 skipped (46 real-Postgres files). All 13 earlier failures reconciled: 11 Slice09 dirty-tree guards pass on a clean tree; `performance-audit` is a `node:test` file — `node --test` → 12/12 pass.
- Push triggers nothing: the repo has no `.github/workflows`.
- Real PostgreSQL: `tests/integration/PersonalisationReads.integration.test.ts` added; result recorded below when the clone run finishes.

## 15. Real-PostgreSQL verification and what it caught (2026-09-20)

Run: `scripts/integration-on-clone.sh goldplus-itest:8412d746 …` on the host — a
throwaway `postgres:16-alpine` on a private network, restored from the newest
production dump, all migrations applied (0144 included), no provider keys,
destroyed with its volume afterwards. Host before/after: ~1.8 GB RAM available,
load < 2.2, disk 39%. This is integration proof, NOT an off-host restore test.

**It caught a bug 8,000 unit tests could not.** `e.event_type = any(pgTextArray(…))`
is rejected by PostgreSQL (`varchar = text[]`: the helper expands to a
subselect). `getSignals` swallows errors and returns the neutral payload, so in
production EVERY visitor would have read as brand-new — silently. Fixed with
`pgInTextList`; an architecture guard bans the broken form; swallowed signal
failures are now logged (`HERO_SIGNALS_FAILED`); the integration test calls the
queries directly so a broken query fails rather than looking like a new visitor.

Results on the final code:
- `PersonalisationReads` 4/4: pure read writes nothing; 3 concurrent creates → 1 row; counter adds across flushes and two processes (9/1/2); serving health reads it; 5 days of rendered rails + impressions = visits 1, affinity none; 3 days of views = visits 3; year-old views fade below 0.3 while lifetime visits stay; a second profile of the same customer inherits the history.
- `MeasurementCore` 14/14, `ExperienceProfile` 5/5, `HeroSignals` 6/6, `RecommendationReaderR3` 6/6, `RecommendationCommercialR31` 7/7, `RecommendationTrendingQuery` 3/3.
- Pre-existing harness issues, untouched by this work: `HeroContent` cannot resolve `@goldplus/shared` from the mounted tests dir; `RecommendationCompatibilityMappings` passes 4/4 but its `afterAll` product delete exceeds the 10 s hook limit on a full-size clone.

Other loose ends closed in this pass: `SHOP_PERSONAL_ORDER` was read from
`import.meta.env` (inlined at build — not a runtime switch) → `process.env`;
`/shop` now calls `GET /hero/affinity` (one indexed query) instead of
`/hero/signals` (orders, loyalty, stock, address); the Steward's "docker build"
probe matched any shell that mentioned the words.

## 16. States (final candidate = HEAD of `deploy/price-floor-145k`)
| State | |
|---|---|
| Implemented | containment, forever-retention, cross-device history, fading affinity, declared-automation guard, shop ordering, this-phone suggestion, compatibility import (prepared) |
| Build-tested | API + web typecheck clean; `astro build` complete |
| Unit/architecture | 8,115 pass; only `ZeroSkipGate` (environment) fails locally |
| Database-verified | YES for the changed SQL (above) |
| Data-ready | compatibility: 34 claims prepared, awaiting owner decision; not applied |
| Production-authorized | NO — migration 0144 + deploy await the owner |
| Deployed / outcome-measured | NO / NO |

## 17. Loose-ends pass (2026-09-20, later)

- **Unindexed foreign key (production issue, pre-existing).** `recommendation_events.source_product_id → products` had no index: deleting one product scanned ~830k rows. Surfaced by a test cleanup exceeding 10 s on the production-size clone. Migration **0145** adds a partial index; on the clone that test went from a hook timeout to 4/4 in 0.4 s. Plain `CREATE INDEX` (migrator is transactional): event inserts wait a few seconds during the build; pages and checkout never wait on event ingestion.
- **The clone harness silently skipped tests.** The image has no `vitest.config.ts`, so files importing `@goldplus/shared` (HeroContent, NavContent, TaxonomyConfig) could never load. The script now mounts the config; all three pass.
- **Server-side search event** on `/shop?search=` is no longer recorded for declared automation (it was the one event path outside the three relays).
- **Steward fix installed on the host** (backup `goldplus-storage-steward.bak-20260920`): verified — a command line that merely mentions "docker build" no longer reads as a running build.
- **Cleaned up after my own testing:** the test builds and clone restores grew the disk 33% → 39% and tripped the Steward's growth alarm. Test images removed, build cache trimmed to the 2 GB policy, logs removed: disk back to 33.4%. The growth-rate alarm clears as its window rolls. Seven older dangling volumes were inspected and LEFT (audit caches and pre-existing data, not mine).
- Synthetic monitor checkout sends no visit header (verified) — it cannot create a profile.

**Real-PostgreSQL result on the final code (image e07beac1 + test timeout fix):** 8 files, **47/47**: PersonalisationReads, RecommendationCompatibilityMappings, HeroContent, NavContent, TaxonomyConfig, HeroSignals, ExperienceProfile, MeasurementCore. Migrations 0144 and 0145 applied cleanly on the production copy.

Release now carries TWO migrations: 0144 (new table) and 0145 (index). Assert for migrate-prod:
`select (count(*)=2)::int from pg_class where relname in ('recommendation_serving_hourly','recommendation_events_source_product_idx')`

## 18. Release closure (candidate `55447fe7` + this docs commit; 2026-09-20 13:10 UTC)

State: **application undeployed** (live = `340fb1f5`); **host tooling updated** (Steward, sha256 `e32e29d6…22dd` = repo file; backup `…steward.bak-20260920` sha256 `d11c1d0b…9889`; rollback = copy the backup back). Steward verified both ways: a command line that only mentions "docker build" → not busy; a process actually named `docker build …` → DEFER. No task-owned process, container, network or tunnel remains on the host or the workstation. Push triggers nothing (no CI workflows).

### 18.1 Isolated staging used for the proof
Candidate API image + newest production dump restored into a throwaway Postgres 16 (900 MB cap) + Redis, private Docker network, API bound to `127.0.0.1` only, random clone-scoped secrets, **no provider keys** (no SMS/email/payment/ads possible), outbox neutralised before start. Candidate web (final build) ran on the workstation through an SSH tunnel. Destroyed afterwards with volumes.

### 18.2 Journeys — measured database deltas (curl, real routes)
| Step | profiles | events | RESPONSE rows |
|---|---|---|---|
| 4 cookieless renders (/, /shop, PDP, /cart) | +0 | +0 | 0 |
| 6 renders with a RETURNED cookie, no action | +0 | +0 | 0 |
| declared-automation product view, cookie retained → HTTP 204 | +0 | +0 | 0 |
| first real action (product view), same browser → 200 | **+1** | **+1** | 0 |
| probe search `/shop?search=` with retained cookie | +0 | +0 | 0 |
| shopper search, same route | +0 | +1 | 0 |
Serving counter rose (23 responses / 6 empty / 17 fallback) with zero flush failures; zero `HERO_*_FAILED`.
Shop: one view (score 1.0) → standard order, no note. View + add-to-cart in Storage (4.0) → note "Showing **Storage Devices** first, based on your recent activity on GoldPlus", `Cache-Control: private, no-store`, opt-out link, page links carry `lead=storage-devices`; all 184 products appear exactly once across pages in both orders; explicit sort, search and `?order=standard` → no personal order, and `order=standard` survives paging; hostile `lead=` ignored. When the interest is already the first category nothing changes and nothing is claimed.

### 18.3 Real browser (Chrome on macOS, desktop viewport — NOT a handset)
First visit to /shop: standard order, no note. Three genuine product-page views (the page's own script sent the events) → /shop leads with Storage and shows the note; clicking "Show the standard order" restores chargers-first and removes the note. Battery finder on a Mac: generic finder, **no** phone suggestion. Console: no errors on /shop or /battery-finder. Product images are placeholders in staging (media volume not mounted) — expected.
**Not observed:** any physical phone or TV; the "this phone?" suggestion appearing (needs an Android browser that reports a model — logic covered by unit tests only); login/logout/account-switch in the browser (covered by existing `ExperienceProfile` integration tests 5/5, not re-observed visually); keyboard/touch passes. Containment for that gap: the suggestion is client-side, hidden by default, stores and sends nothing, and only pre-fills a search the shopper can see.

### 18.4 Migrations — operational envelope (PostgreSQL 16.14)
- FK: `recommendation_events.source_product_id → products(id) ON DELETE SET NULL`; no existing index leads with that column. **0 of 880,621 live rows are non-null**, so the partial index is 8 KB; the cost is one heap scan.
- Build on the production copy (875k rows, 912 MB heap): **1.49 s**, `indisvalid = t`. Through the real runner (drizzle, one transaction): 0144 + 0145 in ~4 s including container start. Attribution of the speed-up: same clone, same fixtures — the product-delete cleanup went from >10 s hook timeout to 0.4 s only after the index existed.
- Lock: plain `CREATE INDEX` takes SHARE on the table: reads continue, INSERTs wait. Writers to this table: browser event POSTs (fire-and-forget, ~818/h now, far fewer after this release) and nothing in checkout/order code (verified by search). During the ~1.5 s build a handful of event requests hold a pool connection; pages and checkout do not write here.
- Bounded: `SET LOCAL lock_timeout='5s'` (abort instead of queueing behind a long transaction — a queued lock would block all later inserts) and `statement_timeout='120s'`. On abort the whole migrate transaction rolls back (0144 too) and is simply re-run. No sessions are killed. Pre-check: no transaction older than 60 s on the table (there were none at 12:50 UTC). `CONCURRENTLY` rejected: the runner is transactional and a failed concurrent build leaves an invalid index to clean up — not worth it for a 1.5 s scan.
- Compatibility: old app + new schema is safe (new table unused, index invisible). New app REQUIRES 0144 (counter table) → migrate first. Application rollback keeps both objects; neither is dropped.
- Post-conditions: `select (count(*)=2)::int from pg_class where relname in ('recommendation_serving_hourly','recommendation_events_source_product_idx')` = 1 AND `indisvalid`.

### 18.5 Tests — one summary
- Chronology resolved: the "13 failures" run executed BEFORE committing (dirty-tree guards did their job). On a clean tree at `ff750336`: **8,116 passed / 1 failed / 241 skipped**; the run leaves the tree clean. All eleven Slice09 guards pass.
- The 1 failure is `ZeroSkipGate`: by contract it fails unless five services exist (`DATABASE_URL`, `COMMERCE_`, `AUTH_`, `ANALYTICS_TEST_DATABASE_URL`, `REDIS_TEST_URL`) via `scripts/integration-env.sh`, which needs local Docker (unavailable on this workstation). It stays red locally — not weakened.
- The 241 skips = the real-Postgres suites (237 before + my 4 new tests). Independently executed on the production clone: 8 files, **47/47**, including every suite touching the changed paths (profiles, hero signals, counter, affinity, reader, commercial stitching). NOT executed anywhere: suites gated only on the AUTH / ANALYTICS / Redis test services — none import the changed modules.
- Harness fix proven by collection: HeroContent 6, NavContent 5, TaxonomyConfig 3 tests now execute on the clone (previously failed to load).
- Audit packages: vitest no longer mis-collects them; `performance-audit` 12/12 under `node --test` (its package script). `compatibility-audit` is Playwright against a live site → post-deploy check.
- Web `tsc` clean and `astro build` complete on the final code (rebuilt for staging).
- Earlier statement corrected: the catalogue has FIVE categories (Power 142, Storage 21, Sound 14, PC 4, Car 3), not "three plus Other".

### 18.6 Decisions (each independent)
| Decision | Evidence | Status | Residual risk | Exact next action |
|---|---|---|---|---|
| Apply 0144 + 0145 | §18.4; applied by the real runner on a production copy | code-ready, DB-verified; **not authorized** | event inserts pause ≤ ~2 s; abort+rerun if a lock isn't free in 5 s | owner approval → `scripts/migrate-prod.sh goldplus-itest:55447fe7 0145-personalisation "<post-condition SQL>"` (takes its own backup + rehearsal first) |
| Deploy api + web | §18.2–18.5 | code-ready, DB-verified, browser-verified on desktop; **not authorized** | handset/TV unobserved; undeclared JS bots | after migrations: `./scripts/deploy-prod.sh <sha> api web`; smoke: /health, /shop, PDP, cart, checkout page, `/recommendations` header; rollback `rollback-340fb1f5` |
| Independent switches | code | ready | — | `SHOP_PERSONAL_ORDER=false` (shop order only); `SSR_IDENTITY_V2`, `PROFILE_READ_PURE`, `RESPONSE_EVENT_TO_METRIC` (containment; turning these off restores the pollution). The phone suggestion has no server switch — it is inert markup; remove via a web redeploy if ever needed |
| Stage battery claims (DRAFT, invisible) | `device-compatibility/` ledger; importer rules run on all 102 | prepared; **not authorized**; not yet rehearsed through the admin UI on a clone | none customer-facing: imports never publish, and all 80 batteries are lifecycle REVIEW | owner approval → upload the CSV at /admin/batteries (type Compatibility), dry run, apply |
| Publish any fit | — | **NO-GO** | — | needs package/fit evidence per claim + battery activation; separate decision |
| Credentials | §13 | **OPEN** | token usable by anyone with the transcript; admin password in git history | owner-only (console sign-ins I must not perform): regenerate the ZeptoMail send token (revokes the old one) and place it in the host env file; change the admin password in the admin UI. Neither blocks this release technically — email does not deliver today — but both stay open until done |

### 18.7 Observation plan (NOT scheduled — manual runbook)
Baselines: ~19–27k events/day, ~95% RESPONSE; nearly every profile seen once; DB p99 ≈ 43 ms; disk 27.4 GB used.
Immediately: smoke list above; `RESPONSE` rows written after deploy = 0; counter rows appearing; zero `*_FAILED` log lines.
15 min / 1 h: API 5xx and p99 unchanged (±20%); new profiles ≈ sessions with an action, not page loads; checkout page loads.
24 h / 72 h: events/day falls by roughly the RESPONSE share; every new profile has ≥1 visitor-action event; disk growth slope flattens; **a fall in visitor-action events, or any drop in orders started, is a failure signal → set the three containment switches to `false` and investigate.**
Undeclared automation watch: profiles/day ÷ visitor-action events/day, bursts of profiles with a single PRODUCT_VIEWED and nothing else, regular inter-arrival timing. Signals for investigation, not proof about any shopper.

## 19. Batteries, phone suggestion, and corrections (2026-09-20 13:40 UTC)

**Runtime candidate is now `1a944208`** (app code) — later commits touch only the Steward, docs and one ledger. Diff `55447fe7 → 1a944208`: `ThisPhoneSuggestion.astro` (new), `battery-finder.astro`, `products/[slug].astro`, `DrizzleDeviceRepository.ts` (publication predicate), tests. Evidence for that diff: web `tsc` + `astro build` clean; full suite at the commit **8,140 passed / 1 failed (`ZeroSkipGate`, environment) / 241 skipped**; real PostgreSQL `PersonalisationReads` **5/5** including the new predicate against a staged DRAFT row; migrations re-applied by the real runner. NOT re-observed in a browser: the two pages that gained the suggestion (the component is hidden by default and was visually confirmed hidden on desktop Chrome in its previous inline form). Diff `ff750336 → 55447fe7` was covered in §18: migration bounds (re-run by the real runner), vitest excludes (full suite), docs/CSV.

**Wording corrected.** `lock_timeout = 5s` bounds how long the migration WAITS for the table lock; it does not mean it never queues — it may queue for up to 5 s, then aborts. 1.5 s build / ~4 s runner time are observations on a copy, not production guarantees; the 120 s statement bound and the `indisvalid` post-condition are the controls.

**What the battery module already had (verified, not rebuilt):** evidence ladder (`SUPPLIER_LISTED → PACKAGE_VERIFIED / FIT_TESTED / VERIFIED_EXACT`, `CONDITIONAL`, `REJECTED`), workflow `DRAFT → REVIEW → READY → ACTIVE → ARCHIVED` with maker≠verifier, publication = claim check × battery check (`publicFitState`, unit-tested for every combination), honest copy ("We have not matched a battery to this phone yet… That does not mean one does not exist"), an assisted request form with WhatsApp hand-off, and request statuses that turn an enquiry into a draft claim (`BATTERY_MAPPED`, `DRAFT_CREATED`). Suspension = archive (history kept).

**Added:** the phone suggestion as one component on the finder and on battery product pages (question, correctable, stores/sends nothing, never evidence); a search that came from it pre-fills the model-number field of the help form; safety/privacy lines on the help form; the publication predicate on two unguarded reads; the grouped evidence-request sheet; ledger reconciled to the native dry run (34 / 23 / 12 / 33).

**Two Steward defects found by using it, both fixed and installed (sha256 `c857106f…`):** the "docker build" probe matched any shell mentioning the words (earlier), and `admit --dry-run` TOOK the lease it was asking about — one check held the heavy-I/O lane for an hour. Verified: consecutive dry runs admit and leave no lease. The Steward later DENIED my second clone run (growth alarm from my own restores); I did not override it and reconciled from the first run instead.

**Host footprint of today's verification:** 26.85 GB → 28.43 GB used (13:36 UTC); one 970 MB image kept on purpose (`goldplus-itest:1a944208`, the migrator image for the release); nothing else of mine remains. Growth alarm: PRESSURE, expected to decay as its window rolls — not yet cleared.

**Decisions (unchanged in kind, updated in detail)**
| Decision | Status | Next action |
|---|---|---|
| Apply 0144+0145, deploy api+web at `1a944208` | code-ready, DB-verified, desktop-browser-verified for shop ordering; suggestion pages build-verified only; **not authorized** | owner approval → `migrate-prod.sh goldplus-itest:1a944208 …` then `deploy-prod.sh` |
| Stage the 69 importable claims as invisible drafts | native dry run passed on a production copy; **not authorized** | owner uploads/approves at /admin/batteries (needs a second person to apply — maker≠checker) |
| Publish any fit | **NO-GO — no claim has evidence yet** | two photos each of BL-49FT and BL-49GX unlock up to 12 fits; then activate those two batteries |
| Send the evidence sheet to the supplier | prepared; **not authorized, not sent** | owner forwards `evidence-request-sheet.md` |
| Credentials | **OPEN** | owner: regenerate ZeptoMail token; change admin password |

## 20. Editable battery compatibility (runtime candidate `fa4fdcdb`, 2026-09-20)

**Gap map (verified in code before building)**
| Capability | Already there | Gap → change |
|---|---|---|
| Battery → phones, add/submit/verify/reject/publish/unpublish/archive/restore, maker≠verifier server-side, evidence upload, device add/merge, material edit reopens review | yes (routes `admin/batteries.ts`, `CompatibilityWorkflow`, unit-tested) | none |
| Phone → batteries | API filtered by `deviceId`; the screen ignored it and the battery page linked there with a slug (dead link) | screen filters by phone, shows all statuses for one battery/phone; phones list links to it; dead link fixed |
| Place a research row with no/unknown battery code | "correct the spreadsheet and upload again" | **Link battery** on the row (migration 0146; beside the row, audited, forces a new dry run, identity only) |
| Replay safety | READY/ACTIVE skipped | ARCHIVED (withdrawn) and reviewer-judged claims now skipped too |
| Suspend a wrong fit | Unpublish / Archive exist | none (documented) |

**Counts, by entity (corrected language).** The native dry run INGESTED 102 source rows into one import session; it created **0** devices and **0** claims (a dry run persists only the session, its rows and events). Of the 102: 57 would create draft claims (34 stronger + 23 weak evidence), 12 are held, 33 cannot be placed. With `proposed-battery-links.md`, 33 of those have a proposed catalogue battery (29 clear/likely, 3 ambiguous, 1 importer-held compound) and 1 has none. Unique live batteries referenced: 23 by code + up to 21 more via links.

**Evidence.** Unit: `BatteryImportRowLinkAndReplay` 5/5. Full suite at `fa4fdcdb`: 8,145 passed / 1 failed (`ZeroSkipGate`, environment) / 243 skipped. Real PostgreSQL (production copy, Steward-admitted, lane released): `BatteryImportRowLink` 1/1 — invalid → link → session back to MAPPED → dry run VALID `CREATE_CLAIM` `SUPPLIER_LISTED`, source cell still empty, devices/claims counts unchanged, one audited event; `PersonalisationReads` 5/5; migrations 0144–0146 applied by the real runner. Web `tsc` + `astro build` clean.
**Not done:** no browser walkthrough or screenshots of the admin screens — they sit behind the admin login and I do not enter passwords; the guide is text. Maker≠verifier was not re-exercised with two identities in staging (it is enforced server-side and unit-tested: "a draft is submitted, then the maker cannot verify it"). Self-review only.

**States:** implemented ✔ · verified (unit + real DB) ✔ · staged ✘ · reviewed ✘ · activated ✘ · published ✘ — the last four need the deploy, then two staff members.

**Release now carries three migrations** (0144 table, 0145 index, 0146 three nullable columns — metadata-only `ADD COLUMN`, no rewrite). Post-condition adds: `select count(*)=3 from information_schema.columns where table_name='battery_import_rows' and column_name like 'linked_battery_%'`.

## 21. Self-review with a real browser, and the gate I had under-reported (2026-09-20, candidate `12d3c7f8` + this commit)

**Browser proof (Chromium via Playwright, Android identity SIMULATED — not a physical handset), isolated staging on a production copy:**
finder shows *"Shopping for the phone you are using? Check batteries for TECNO KG5k — or choose a different phone."* → click lands on `/battery-finder?from=this-phone&q=TECNO%20KG5k` → honest *"We have not matched a battery to this phone yet"* → help form opens with the model number pre-filled and the no-IMEI / do-not-open-the-phone line → "choose a different phone" returns to the bare finder and an explicit search (`BL-49FT`) wins. Hidden for reduced Chrome ("K"), iPhone and desktop Mac. On a battery product page: suggestion + *"Check your phone before you buy"* render at phone width with **no fit claim shown**; absent on a non-battery product. Console: only Cloudflare-analytics CORS noise from localhost and a placeholder-image 404. Screenshots: `docs/personalisation/evidence/01…03-android-*.png`.
What "stores and sends nothing" means precisely: passive detection sends nothing; **clicking the link puts the model code in the URL** (`q=`), which the server and any page analytics then see, like any search the shopper types.

**The gate I had not spelled out.** A battery product page shows its battery panel (fit facts, the note, the suggestion) only when the battery is **ACTIVE**, and the database enforces that ACTIVE needs a publisher. The system's activation checklist (`BatteryReadiness`) requires per battery: confirmed code · primary photo · price ≥ its floor · a stock record · **verified against the physical pack** · capacity (mAh) + voltage read from the pack · approved product · ≥ 1 VERIFIED phone. Production today, all 80 batteries: photo **0**, capacity+voltage **0**, code confirmed **0** (51 provisional, 29 device-named), pack-verified **0**, stock record 80, approved 80; lifecycle 51 DRAFT + 29 REVIEW (I had said "all in review"). So the phone matches, however good, cannot be public until packs are photographed and read. One front + one back photo per battery supplies the photo, code, capacity, voltage and usually the phone list.
Also flagged, not changed: all 80 batteries show exactly **200 in stock** — asked the client whether that is real.

Host after teardown: no task-owned containers; migrator image `goldplus-itest:12d3c7f8` kept on purpose; 28.69 GB used.

## 22. RELEASED to production — 2026-09-20 (owner: "proceed … fully implement")

| Step | Result |
|---|---|
| Preflight | Steward PRESSURE/admit, 1.9 GB RAM free, disk 38%, 0 transactions older than 60 s, live app `340fb1f5` |
| `migrate-prod.sh goldplus-migrator:16ac9afc` (0144–0147) | backup `goldplus-prod-pre-0144-0147-personalisation-batteries-20260920-185345.dump` (158 MB) → rehearsal on a copy, run twice → **REHEARSE_OK** → live → assertion = 1 (table + valid index + 3 link columns + Benco inactive) |
| `deploy-prod.sh 16ac9afc api web` | **DEPLOYED, 4/4 healthy**, `rollback-16ac9afc`; previous runtime kept as `rollback-pre-340fb1f5` |
| Found live, minute 1 | 5 profiles with no visitor action — automatic hero `IMPRESSION` / nav `NBA_IMPRESSION` beacons created them |
| Hotfix `0e4bc8d2` (api) | exposure beacons resolve read-only; only a visitor action creates a profile. **DEPLOYED 2/2 healthy** |
| Found live, minute 7 | 8 add-to-carts from our own post-deploy Playwright smoke (normal Chrome UA) |
| Hotfix `b815e300` (web) | the audit declares itself with a first-party `gp_probe` cookie; relays drop it. **DEPLOYED 2/2 healthy** |
| Public check (Chrome, through Cloudflare) | `/battery-finder` renders; `/products/benco-23011-battery` → 404 |

**First 13 minutes on production vs the same window yesterday:** rendered-rail rows **0** (counter: home_trending 532, product_related 97, cart_addon 64, complete_setup 97 empty); new profiles **16 vs 170**, all 16 with a visitor action (and all from our own smoke run, before it was taught to declare itself); behaviour events **34 vs 190**; hero/nav exposure beacons still recorded (12 / 109) with the profile optional; API errors 0; 4/4 healthy.
Rollback: `rollback-pre-340fb1f5` images, or the three containment switches. Schema objects stay on rollback.
**Not scheduled:** the 1 h / 24 h / 72 h observations (runbook §18.7). **Not done (needs people):** import upload + second-person approval, aliases, pack data, battery activation, publishing.
