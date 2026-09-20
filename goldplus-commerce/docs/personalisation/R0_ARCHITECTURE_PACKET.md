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
