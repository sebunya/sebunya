# Canonical ownership — single source of truth per capability
SHA `707876d` · 2026-08-03. A capability's owner is the ONLY place its rules live. Adding a second implementation of any row below requires MERGE or REPLACE_WITH_PROOF per the preservation contract — never a parallel copy.

| Capability | Canonical owner | Notes |
|---|---|---|
| API origin resolution (web) | `apps/web/src/lib/api.ts` (`apiBase`, `resolveApiOrigin`) | SSR→INTERNAL_API_ORIGIN, browser→PUBLIC_API_BASE_URL, empty-safe. 78 consumers. |
| Cart identity (mint/verify) | `packages/shared/src/cart-credential.ts` keyring; web mints in `apps/web/src/lib/cartCredential.ts`; API verifies in `apps/api/.../middleware/cartCredential.ts` | `__Host-gp_cart`; secrets: CART_CREDENTIAL_SECRET (dedicated). |
| Checkout intent | `packages/shared/src/types/checkout.ts` + web `lib/checkoutIntent.ts` + api `middleware/checkoutIntent.ts` | `__Host-gp_checkout_intent`; CHECKOUT_INTENT_SECRET. |
| Cart mutations/read | `apps/api/src/application/use-cases/commerce/MutateCartUseCase.ts` + `DrizzleAuthorizedCartRepository` | Version-fenced replaceItems; create-on-first-ADD (RC-7); prices from catalogue, never the request. |
| Server-side pricing | canonical `PricingEngine` (apps/api application layer) | Preserve; checkout resolves prices server-side; `product_prices` is authority, `products.price_ugx` display fallback. |
| Order lifecycle | `OrderStateMachine` + transactional order-event ledger | State transitions validated + audited; do not bypass. |
| Checkout execution | `ExecuteCheckoutIntentUseCase` | Fingerprint/claim/fence/price/order/reserve/complete; idempotent; client items priced server-side. |
| Payment webhooks | `/webhooks/payment/*` routes + idempotency-key replay protection | Mandatory idempotency (CLAUDE.md); replay-verified in synthetic write journey (dormant in prod). |
| Money | bigint UGX throughout | No floats. |
| Permissions registry | `packages/shared/src/permissions/index.ts` (constants) + api `middleware/permissions.ts` (enforcement) + DB `permissions`/`role_permissions`/`roles`/`user_roles` | Code `X.Y` ⇒ action=X, resource=Y. Sync must be code-driven (governed-admin slice). |
| Session/auth | api `middleware/auth.ts` + customerSession.ts; HttpOnly `goldplus_session` | Admin pages send cookie; measurement proxy attaches bearer server-side. |
| Admin module APIs (6 modules) | `apps/api/.../routes/admin/new-modules.ts` via `Registry.getInstance()` | Permission-guarded, audited mutations. |
| Queues/workers | `infrastructure/queues/QueueService|QueueWorkers` (BullMQ) + `infrastructure/scheduler/*` | Synthetic monitor write stages env-gated OFF in prod (RC-5). |
| Outbox | transactional outbox (`outbox_events`) | Critical events only through outbox; fencing preserved. |
| Abuse controls | Redis-backed publicAbuseControl + botDetection middleware | Readiness-reported. |
| Recommendations | canonical recommendation engine + placement registry | Preserve scoring; rules/analytics layered on top, never forked. |
| Measurement | canonical event contract + sGTM containers + measurement routes + DLQ | Same-origin admin proxy `apps/web/src/pages/api/admin/measurement/[...path].ts` (allowlist). |
| Consent | consent routes + consent-operating surfaces | Consent gates sends; no fabricated identity. |
| Production topology | `docker-compose.production.yml` + `Caddyfile` + `.env.production` (host-only) | ONLY the principal integrator edits these. |
| Migrations | drizzle migrations + `meta/_journal.json` | ONE migration writer at a time; journal is append-only. |

## Single-writer rules (F4)
Only the principal session edits: Registry, permissions registry, shared route composition (`app.ts`), global runtime config, migration journal, production Compose, Caddyfile. Subagents implement bounded slices and return diffs for integration.
