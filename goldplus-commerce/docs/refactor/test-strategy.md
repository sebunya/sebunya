# Test Strategy

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, read-only audit only.

## Current Gate Results

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm lint` | FAIL | One error in `apps/web/src/lib/telemetry.ts`; 26 warnings. |
| `pnpm run typecheck` | PASS | `tsc --noEmit` for shared, API, web. |
| `pnpm test:architecture` | PASS | 10 tests passed. |
| `pnpm test:unit` | FAIL | `/metrics` test timed out in `tests/unit/Observability.test.ts`. |
| `pnpm test` | FAIL | Same `/metrics` timeout; 384 passed, 1 failed. |
| `pnpm run build` | PASS | Sentry warnings emitted. |
| `pnpm audit --audit-level=high` | FAIL | 1 critical, 5 high, 15 moderate, 3 low. |

## Current Strengths

- Architecture fitness tests exist.
- Recommendation behavior has meaningful unit coverage.
- Payment, notifications, catalog, checkout, order, governance, and identity areas have unit tests.
- Build succeeds despite the dirty worktree.
- CI includes lint, typecheck, architecture, unit, build, audit, Semgrep.

## Current Gaps

- `.astro` templates are not fully checked by current `tsc --noEmit` script.
- `/metrics` depends on live Redis/BullMQ behavior and fails without bounded timeout.
- Architecture tests skip known application-to-infrastructure leaks.
- Admin route auth coverage is incomplete for `/governance/admin/*`.
- No explicit degraded-start deployment test for API down but web/Caddy up.
- No service worker/offline automated test.
- No accessibility gate observed.
- Dependency audit currently fails.

## Recommended Fitness Functions

- Admin route protection: every `/admin/*` and `/governance/admin/*` endpoint must reject missing auth.
- Metrics resilience: `/metrics` must return within a bounded time when DB or Redis is unavailable.
- Deployment isolation: Caddy and web must be able to start when API is unhealthy.
- Architecture: application layer must not import infrastructure, with exemptions converted into explicit failing TODO tests after migration.
- Protected recommendations: snapshot placement/event enum values and storage keys.
- Accessibility: run axe/Playwright smoke for checkout, shop, product detail, admin login.

## Pass-Level Test Rules

- Run the smallest relevant tests first.
- Run full `pnpm lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build` before completing a pass.
- For deployment changes, additionally run compose config validation and degraded-start smoke.
- For dependency changes, run `pnpm audit --audit-level=high` and full gates.

