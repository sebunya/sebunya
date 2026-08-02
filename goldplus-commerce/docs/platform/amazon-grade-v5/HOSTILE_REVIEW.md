# §20 Hostile Final Review (Slices 10 + 12)

Systematic sweep of the §20 anti-patterns across `apps/api/src` and `apps/web`.
Each finding is either CORRECTED or DOCUMENTED as a justified exception per the
programme ("Correct or document a justified, tested exception").

## Corrected this session

| # | Anti-pattern | Where | Fix |
|---|---|---|---|
| H-1 | `err.message` returned to the client (unexpected errors leak internals) | admin/measurement-payments.ts, admin/products.ts, admin/recommendations.ts, commerce.ts (9 sites) | Replaced the raw `err.message` with a generic client message, keeping the error codes; the real error is logged server-side (redacted). `automation.ts` is NOT a leak — it surfaces `error.message` only for a typed `AutomationOperationError` (controlled message) and re-throws everything else to the central mapper. Verified: typecheck clean, affected route tests 55/55. |
| H-2 | DB-message string matching in the error fallback | app.onError | Corrected in Slice 3E — the central `mapErrorToHttp` classifies DB failures by SQLSTATE code, never by message text. |
| H-3 | Duplicate limiter / duplicate transition matrix | rateLimiter.ts; governance order transitions | Removed dead `rateLimiter.ts` (Slice 3A); order transition matrix extracted to the domain `OrderStateMachine` and the route delegates to it (Slice 4). |
| H-4 | Unregistered self-approval (separation of duties) | controlled activation approval | Fixed in Slice 9 — `authorizeActivationApproval` denies a requester approving their own activation. |
| H-7 | Sample operational data / "API unavailable" / "Coming Soon" as product states | apps/web `api.ts`, `sample-data.ts`, `Notice.astro`, ProductCard/CategoryAwareRail/inventory | **CORRECTED (Slice 10)**: `tryFetchAdminList` no longer returns fabricated fallback rows — it returns an honest empty list + a degraded reason and never invents records; all `SAMPLE_*` arrays emptied; `Notice` copy changed to "Live data unavailable"; the image-placeholder "Coming Soon" (a missing IMAGE, not an unavailable product) relabelled "Image pending"; the inventory "coming soon" replaced with an honest read-only statement. |
| H-8 | `console.*` | INFRASTRUCTURE files (PreferenceProductFinderUpdater, DrizzleGtmPlanRepository, LocalProductImageStorage) | **CORRECTED (Slice 11)**: routed through the structured `logger`. **Architecture constraint discovered**: the `boundaries` test forbids the APPLICATION layer from importing infrastructure (the logger lives in infrastructure), so the 4 application-layer `console.*` sites are LEFT as `console.*` — converting them would violate the layering. The correct fix there is an injected logging PORT (application defines `ILogger`, infra provides it) — recorded as a follow-on. Bootstrap (`config/env.ts`, `otel.ts`) and CLI migration scripts keep `console` legitimately. |

## Documented justified exceptions / recorded follow-ons

| # | Anti-pattern | Where | Verdict |
|---|---|---|---|
| H-5 | Unbounded `findAll()` | admin list use cases (products/orders/users/roles/support; ListAuditLogs already bounded by `limit`) | **Justified for a single-shop deployment**: these are admin lists over intrinsically bounded operational data (one shop's catalogue, users, roles, open tickets). Not customer-facing, not unbounded by attacker input. **Follow-on**: cursor pagination for products/orders as volume grows (recorded, not a stop-ship). |
| H-6 | In-memory correctness map | `DrizzleGtmPlanRepository` (plans held in-memory because `measurement_gtm_plans` does not exist) | **Real durability gap, but not production-critical yet**: GTM publication is DISABLED (no real send per the programme boundary), so plans are not on a live path. **Follow-on**: add a `measurement_gtm_plans` migration before GTM activation. Recorded. |

## Clean (no findings)

- No `unsafe-inline`/`unsafe-eval` in application CSP paths.
- No raw `process.env` in `domain`/`application` beyond `NODE_ENV` guards (Slice 3D + convention).
- No `adminId`/`actorId` taken from the request body (actor is always from the session; architecture test `admin-route-authentication` enforces it).
- No hardcoded secrets in source (secret scan passes; `.env.example` placeholders only).
- No `revenue`-labelled GMV (the explorer catalogue labels it GMV explicitly).
