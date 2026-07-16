# Slice 10-E + 0B — 10-D crash root cause fixed; fresh-replay + live E2E verified locally

Date: 2026-07-16 · Branch: `phase-2-measurement-control-tower-completion`
Environment: local PostgreSQL 16 cluster + API under tsx in the remote container
(throwaway local-only env values; no production access, no secrets).

## Slice 10-E — root cause of the failed 10-D deployment REPAIRED

The 10-D deploy crashed both API replicas with
`TypeError: client.unsafe(...).values is not a function` and was rolled back with
no repair attempted. Reproduced locally on first boot of a full stack: the
observability wrapper in `infrastructure/db/client.ts` eagerly `.then()`d the
postgres-js Query — triggering execution AND replacing the chainable Query with a
plain Promise, so drizzle's `client.unsafe(...).values()` crashed **every
db.select()** (`/products`, `/products/suggest`, checkout…).

Fix: the wrapper now returns the SAME lazy Query and instruments it by
intercepting `.then` (metrics on first await, settle-once accounting). Verified
live: previously-500 endpoints return 200. Regression test
`Slice10EDbClientWrapper.test.ts` pins the chainable contract.

## Slice 0B — migration chain could not rebuild a database (repaired)

Fresh-replay testing found migration `0018` aborts on any new database:
four FKs join varchar(36) columns to `users.id uuid` (SQLSTATE 42804), so the FK
statements have NEVER applied in any environment. Repairs:
- `0018`: the four dead FK blocks additionally tolerate `datatype_mismatch`
  (resulting schema identical to every existing environment; nothing that ever
  executed successfully was altered).
- `0028` (new, additive): converts `release_decisions.recorded_by`,
  `release_readiness_audit_log.admin_user_id`,
  `release_readiness_gate_results.acknowledged_by`,
  `release_readiness_runs.triggered_by` to uuid with lossless USING casts, then
  adds the four FKs guarded/idempotently. Schema definitions aligned to uuid.

**Fresh replay result: 0000→0028 apply cleanly; 115 tables; all four repaired
FK constraints present.**

## Live end-to-end verification (previously environment-gated)

| Check | Result |
|---|---|
| `/health`, `/products`, `/products/suggest` | 200 (products/suggest were 500 pre-fix) |
| Forged-price checkout (client sent price 1, name "hacked") | Server charged catalogue price 85,000×2; item name from catalogue; subtotal 170,000 |
| Configured district (KAMPALA zone 8,000) | fee 8,000, `deliveryFeeConfirmed: true`, total 178,000 |
| Unconfigured district (Moroto) | fee 0, `deliveryFeeConfirmed: false` — truthful |
| Idempotent resubmission (same clientOrderKey) | `idempotentReplay: true`; exactly 1 order row |
| Unknown product / malformed body | `PRODUCT_UNAVAILABLE` / Zod `INVALID_CHECKOUT` |
| Login lockout | attempts 1–5 → 401 generic; attempt 6 → **429** |
| Anonymous search demand | zero-result query aggregated: `solar panel | 1 | 1 | open` |
| Admin endpoints without token (delivery-zones, search-demand, compatibility, loyalty/config, lifecycle) | all **401** fail-closed |
| Suggest payload | retail price only; no dealer fields |

## Production impact

The 10-D deployment blocker is now a fixed, regression-tested source defect.
Deployment itself remains operator-approval-gated; migrations 0023–0028 remain
unapplied in production. No production system was touched; local env values were
throwaway and never printed as secrets.
