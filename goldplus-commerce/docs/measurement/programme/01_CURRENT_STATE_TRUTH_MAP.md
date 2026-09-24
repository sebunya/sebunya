# 01 — Current-state truth map

Established 2026-09-20 against commit `19b2d2d4` (branch `deploy/price-floor-145k`, deployed to production).
Baseline: `npx vitest run tests/unit tests/architecture apps/api/tests/unit` → 473 files / 7,959 tests pass on a
clean tree (the Slice09 suite fails by design while the tree is dirty). Governing instruction:
`docs/measurement/16_CLAUDE_CODE_MASTER_IMPLEMENTATION_PROMPT.md`. Authority order (dossier §0): owner
decisions → repository/runtime facts → dossier contracts.

Classification vocabulary: KEEP, HARDEN, MERGE, REPLACE_WITH_PROOF, DEPRECATE_WITH_PROOF, MISSING,
ACCOUNT_REQUIRED, EXTERNAL_DEPENDENCY, CAPABILITY_VERIFICATION_REQUIRED.

## Runtime facts that shape everything

| Fact | Evidence | Consequence |
|---|---|---|
| Production host: 2 vCPU, 3 GB RAM, 75 GB disk (85% used after cleanup, 97% before) | `nproc`, `free -g`, `df -h` on goldplus-prod, 2026-09-20 | ClickHouse/PeerDB/Dagster/science CANNOT share this host (dossier §1.3, §11.1 also forbid contention with commerce Postgres). EXTERNAL_DEPENDENCY: a separate analytics host. |
| Real commerce volume: 38 orders, all owner/test data; 0 paid orders ever | `src/scripts/pesapal-reconciliation.ts` run 2026-09-19 | Attribution/experiments/MMM/CLV are DATA_INSUFFICIENT for production results; code + fixtures only. |
| Topology: Cloudflare → Caddy (not Nginx) → api/web containers; Postgres, Redis/BullMQ, sGTM in the same compose | `Caddyfile`, `docker-compose.production.yml` | Real client IP = Caddy `{client_ip}` (trusted_proxies = Cloudflare ranges). |
| Owner decision 2026-09-19: server-side analytics ALWAYS ON incl. GPC; IP/UA kept, server-side | memory + `docs/measurement/SERVER_SIDE_GA4.md` §Policy | Supersedes dossier consent-gating for analytics (see 03_DECISIONS D-001). |

## Capability map

| Capability | Path / symbol | Entry point | Tables | Workers | UI | Tests | Classification |
|---|---|---|---|---|---|---|---|
| Order status transitions (single transactional authority) | `infrastructure/orders/OrderTransitionService.ts` `apply()` | settlement, admin, fulfilment | `orders`, `order_events` (idempotency_key unique) | post-commit subscribers | admin orders | order-transition-canonical arch test | KEEP — the event-append point (GP-EVT) |
| PesaPal verification | `application/use-cases/payments/VerifyPesaPalPaymentUseCase.ts` → `SettlePaymentUseCase` → `ReconcileOrderPaymentUseCase` | IPN, callback, poll, outbox verify | `payment_attempts`, `checkout_idempotency` | reconciliation poller (10 min) | /admin/measurement/payments | pesapal-payment tests | KEEP (fixed 2026-09-19: status 0 on young attempt = pending) |
| Checkout / COD placement | `routes/commerce.ts` → `executeCheckoutIntentUseCase` | POST /commerce/orders | orders, order_attribution (0111/0136/0137/0139) | side-effect outbox | storefront | many | KEEP |
| Browser behavioural events | `web/lib/telemetry.ts` → `/telemetry/collect(/batch)` → `TrackBrowserTelemetryEventUseCase` | beacon | `outbox_events` (TELEMETRY_DISPATCH) | `TelemetryDispatchService` (ticker + BullMQ) | — | MeasurementServerSide tests | HARDEN (no batch receipt/idempotency contract, dossier §7.1) |
| GA4 server-side | `TelemetryDispatchService.dispatch` → `Ga4CollectHit` → sGTM `/g/collect` | outbox | outbox_events | ticker/worker | — | Ga4CollectHit tests | KEEP, VERIFIED_PRODUCTION (realtime 2026-09-19) |
| Purchase / refund to GA4 + ads | authoritative `order_confirmed` event appended by the order transition (0140) → delivery intents (`PurchaseTelemetry.ts` and `queuePurchaseTelemetry`/`queueRefundTelemetry` are REMOVED) | order transition | business events + delivery intents | delivery workers | — | MeasurementServerSide, PlatformSecuritySweepLow | DONE (GP-EVT/GP-DLV) |
| Ad conversion dispatch | `infrastructure/advertising/AdConversionDispatch.ts`, `AdPlatforms.ts` | fan-out from telemetry dispatch | outbox_events AD_CONVERSION, `ad_destinations` (0138) | OutboxTicker | /admin/advertising | AdPlatforms tests (22) | HARDEN: no STARTED marker / UNKNOWN_OUTCOME / generations / attempt history (dossier §5) |
| Legacy paid-social mappers, ConversionRouter, BullMQMeasurementQueueAdapter | `infrastructure/measurement/destinations/*`, `ConversionRouter.ts`, `BullMQMeasurementQueueAdapter.ts` | none (unreachable) | — | mock queue | Paid social readiness panel | mapper unit tests | DEPRECATE_WITH_PROOF (dead code; mock queue returns fake job ids) |
| `EnvPaidSocialCredentialStatusRepository` | always returns configured/valid | wired, unread | — | — | — | — | DEPRECATE_WITH_PROOF (fake readiness) |
| Measurement flags MEASUREMENT_DRY_RUN / LIVE_DESTINATIONS_ENABLED / PAID_SOCIAL_QUEUE_ENABLED | `config/env.ts` | parsed, read by nothing | — | — | — | — | REPLACE_WITH_PROOF (enforced gate, GP-POL) |
| Consent | `ConsentService`, `consent_current_state`, preference centre | account prefs | consent tables | — | /account/preferences, admin consent | tests | KEEP with owner policy (D-001) |
| Credential vault | `seo/IntegrationCredentialVault.ts` (AES-256-GCM; key SEO_CREDENTIAL_VAULT_KEY → falls back to JWT_SECRET) | admin | ad_destinations.secret_enc, seo, aiv | — | admin | tests | HARDEN (key fallback to JWT_SECRET; no key version) |
| Product costs (COGS source) | 0104 product costs; 184 costs loaded 2026-09-18 | admin/import | product cost tables | — | /admin/product-costs | tests | KEEP — COGS snapshot source for commercial ledger |
| Refund ledger | `RefundPesaPalPaymentUseCase`, refund tables | admin | payment_refunds, refund lines | — | admin | tests | KEEP — source for refund_confirmed |
| PostHog | env key + canary transport only | — | — | — | canary panel | — | EXTERNAL_DEPENDENCY (no project key configured) |
| Clarity | `BaseLayout.astro` behind PUBLIC_CLARITY_ID | build arg | — | — | — | tests | ACCOUNT_REQUIRED (project id) |
| ClickHouse, PeerDB, Dagster, dlt, dbt, science runners | — | — | — | — | — | — | MISSING + EXTERNAL_DEPENDENCY (analytics host) |
| Control Tower | `/admin/measurement*`, controlled-activation*, measurement-control-tower | admin | several | — | many pages | many | HARDEN: several panels read stubs (paid-social readiness) |

## Real transaction traced (dossier §2.1)

PesaPal IPN → `routes/commerce` IPN handler → `SettlePaymentUseCase.execute` → `VerifyPesaPalPaymentUseCase`
(GetTransactionStatus, amount/currency/reference checks) → `orderTransition.transition(orderId,'processing',
{paymentStatus:'paid', idempotencyKey:'pesapal:completed:<tracking>'})` → `OrderTransitionService.apply` (row lock,
`canTransitionOrder`, `orders` update, `order_events` insert; replay returns the existing event) → commit →
post-commit subscribers → `ReconcileOrderPaymentUseCase` → settlement effects (fulfilment, loyalty, admin email,
`recordMeasurement` (PesaPal measurement reconciliation only), customer message). The GA4/ad purchase is no
longer queued here: the order transition appends the authoritative `order_confirmed` event in the same transaction
(GP-EVT, 0140), so it is atomic with the business transition.
