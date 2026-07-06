# Testing Report — Debug & Feature Pass (2026-07-06)

## Baseline (before changes)

| Check                        | Result |
|------------------------------|--------|
| `pnpm typecheck` (3 packages)| ✅ pass |
| `pnpm test` (vitest)         | ✅ 100/100 tests, 19 files |
| `pnpm build` (api + web)     | ✅ pass |

Core flows covered by the existing suite and re-verified: product catalogue &
filtering, cart, checkout, order tracking, payment webhook idempotency, quotes,
dealer applications, support, verification, governance/audit, admin auth,
outbox processing, product images/attributes.

## Bugs found & fixed

1. **`requestId` never set on routed requests** —
   `apps/api/src/interfaces/http/app.ts` registered the request-id middleware
   *after* all routes, so Hono never ran it for routed paths and error
   envelopes (`meta.requestId`) carried `undefined`. Middleware moved above
   route registration. This restores request correlation in error logs.

2. **ZeptoMail adapter was a stub** — it returned
   `PROVIDER_NOT_WIRED` even with valid credentials. Replaced with a real
   HTTP transport (see `docs/transactional-email.md`); the "not configured"
   truth-telling behaviour is preserved and now unit-tested.

## After changes

| Check                        | Result |
|------------------------------|--------|
| `pnpm typecheck`             | ✅ pass |
| `pnpm test`                  | ✅ 138/138 tests, 23 files |
| `pnpm build`                 | ✅ pass |
| Architecture tests           | ✅ pass (domain purity, layer boundaries, admin auth/audit rules) |
| Drizzle migration generated  | ✅ `0005_stale_firelord.sql` via `pnpm db:generate` |

## New test files (38 new tests)

- `tests/unit/ActivityEvent.test.ts` — event vocabulary, validation limits,
  property sanitisation, recording, engagement summary window clamping.
- `tests/unit/Experimentation.test.ts` — experiment validation, deterministic
  assignment, weight distribution, lifecycle transitions, duplicate keys,
  exposure event recording, non-running refusal.
- `tests/unit/Loyalty.test.ts` — earn rate & flooring, tier thresholds, ledger
  summarisation, award idempotency under webhook replay, guest orders,
  sub-threshold orders, customer summary.
- `tests/unit/ZeptoMailAdapter.test.ts` — NOT_CONFIGURED short-circuit, real
  request shape (endpoint/auth/body), success & failure mapping, network error
  handling, recipient validation, template rendering + HTML escaping.

## Not covered (requires a live environment)

- End-to-end database round-trips for the three new tables (repositories follow
  the same Drizzle patterns as the 19 existing ones; migration applies cleanly
  by construction from `drizzle-kit generate`).
- A real ZeptoMail send (needs live credentials); the HTTP contract is tested
  against the documented API shape.
