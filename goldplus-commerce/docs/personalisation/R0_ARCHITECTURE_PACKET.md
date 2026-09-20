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
