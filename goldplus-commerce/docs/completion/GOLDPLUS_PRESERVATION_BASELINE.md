# GoldPlus Preservation Baseline

Generated from current source at branch `phase-2-measurement-control-tower-completion`,
head `4b4016c` (Slice 10-D Deploy R2 Perfect), 2026-07-15.
Working environment: remote Claude Code container; worktree
`goldplus-clean-continuation/phase-2-measurement-control-tower-completion-20260715`.

No slice may modify a capability below without naming: why it must change, the exact
regression risk, the tests that protect it, and how rollback works.

| Capability | Source paths | Tests | Schema/migrations | Live status | Regression guard |
|---|---|---|---|---|---|
| Architecture boundaries (Clean/Hexagonal, thin Hono routes, pure domain) | `apps/api/src/{domain,application,infrastructure,interfaces}` | `tests/architecture/` (2 suites) | n/a | LIVE (production runs `bfa6de6`) | `pnpm test:architecture` |
| Auth / RBAC / identity | `apps/api/src/interfaces/http/routes/auth.ts`, `apps/api/src/infrastructure/identity/`, `apps/api/src/domain/identity/`, `packages/shared` permissions (29 permission strings), admin `roles.ts`/`users.ts` routes, `apps/api/src/scripts/admin-bootstrap-owner.ts` | `tests/unit` auth/RBAC suites | `identity.ts` schema, migrations ≤0022 | LIVE (protected redirect verified in 10-PR2G evidence) | RBAC route assertions in unit suite |
| Catalogue / PDP / cart / storefront | `apps/web/src/pages/` (84 pages incl. shop, products, cart, compare, product-finder, verification, track-order), `apps/api/src/domain/products/`, `commerce.ts` routes | `tests/unit` product/cart suites | `products.ts`, `commerce.ts`, `addresses.ts` | LIVE (storefront 200 verified 10-PR2G) | unit + Playwright flows |
| Checkout / payment state machine / PesaPal | `apps/api/src/domain/payments/{PaymentStateMachine,PaymentIdempotencyService}.ts`, `use-cases/checkout/StartCheckoutUseCase.ts`, `use-cases/payments/{StartPesaPalPayment,VerifyPesaPalPayment,RecordPaymentWebhook}UseCase.ts`, ports `IPesaPalClient`, `IPesaPalPaymentRepository`, `IPaymentRepository` | `tests/unit` payment suites | `commerce.ts` schema; payment tables | LIVE | idempotency + state-machine unit tests; never duplicate this engine |
| Recommendations (rule system, eligibility, diversity, fallback, analytics) | `apps/api/src/application/recommendations/` (25 modules incl. `CompatibilityRuleService`, `PreviewRecommendationRulesUseCase`), `routes/admin/recommendations.ts`, `routes/recommendations.ts`, `apps/web/src/pages/admin/recommendations/`, `docs/recommendation-engine-v2.md` | `tests/unit` recommendation suites | `recommendations.ts` schema | SOURCE newer than production | rule validation/conflict/preview tests; no competing engine (see note below) |
| Consent / preference centre | `apps/api/src/domain/consent/`, `use-cases/consent/`, `infrastructure/consent/`, `routes/consent*.ts`, `apps/web/src/pages/preferences.astro`, Preference Centre | `tests/unit` consent suites; 10-C hardened test 440/440 (evidence) | `consent.ts`, `consent-foundation.ts` | LIVE (4-event ledger verified read-only, 10-PR2G) | consent lifecycle tests; no provider sends |
| Measurement / destinations / control tower | `apps/api/src/infrastructure/measurement/`, `routes/admin/measurement*.ts`, `routes/measurement.ts`, `apps/web/src/pages/admin/measurement*`, `infra/measurement/`, `infra/cdp/` | `tests/uat/measurement-control-tower/` (7 suites) + unit | `measurement.ts`, `measurement-advanced.ts`, `measurement_control_tower.ts` | Control room source ready, 10-D NOT deployed (approval-gated) | UAT suites; no-send defaults |
| Consent Operations Control Room (10-D) | `routes/admin/consent-operations.ts`, `ConsentOperationsSummaryService`, `/admin/consent-operations` page | 32 focused tests (evidence: 10-D PRIME) | read-only; no new tables | SOURCE_COMPLETE_NOT_DEPLOYED | deterministic classifier tests; no mutation endpoint |
| Support tickets | `apps/api/src/domain/support/SupportTicket.ts`, `ports/ISupportRepository.ts`, `DrizzleSupportRepository.ts`, `use-cases/governance/OpenSupportTicketUseCase.ts`, `apps/web/src/pages/support/` | unit coverage partial | `governance.ts` schema | LIVE (customer-facing) | do not create a second ticket model |
| Product finder / preferences | `apps/api/src/infrastructure/product-finder/`, `infrastructure/preferences/`, `routes/product-finder.ts`, `apps/web/src/pages/product-finder.astro` | unit suites | `product_finder.ts`, `preferences.ts` | LIVE | keep public saves gated |
| Release readiness / controlled activation | `apps/api/src/infrastructure/release/`, `infrastructure/activation/`, `routes/admin/release-readiness.ts`, `presentation/routes/controlled-*`, `scripts/release/` | unit + protected suites (700/700 evidence) | `release_readiness.ts`, `activation*.ts` | Source ready; deployment approval-gated | protected release-gate tests |
| Runtime packaging (repaired after production failure) | Node-compatible compiled API, CommonJS runtime, compiled shared workspace, image-local shared entrypoint → `dist/index.js`, immutable Node 20 Alpine digest, plain-Node image-start smoke | image-start smoke | n/a | LIVE at `bfa6de6` | NEVER: extensionless ESM emit, tsx-in-prod, floating `node:20-alpine` |
| Outbox / notifications (no-send) | `apps/api/src/infrastructure/outbox/`, `infrastructure/notifications/`, `routes/admin/notifications.ts` | unit suites | `phase11.ts` outbox tables | LIVE, zero outbox rows / zero attempts (verified) | provider flags default false; DRY_RUN never fetches |
| Loyalty truthful foundation | `apps/web/src/lib/loyalty-foundation.ts`, `pages/loyalty.astro`, `pages/admin/loyalty.astro` | guardrail constants | none (deliberate) | LIVE as truthful "being prepared" state | FORBIDDEN_LOYALTY_CLAIMS list; no fake points |

## Cross-branch duplication note (binding)

A parallel recommendation control-room module (merchandising pin/boost/bury/exclude,
surface-config draft/publish/rollback) exists ONLY on branch
`claude/goldplus-debug-features-8ku4ns` (preserved at `5201143`). It was built against
the pre-phase-2 architecture and MUST NOT be ported onto this branch: this branch's
`application/recommendations/` rule system (Slice 6-F1) is the authoritative engine.
Any future capability gap (e.g. surface-level pinning) must extend the existing rule
system, passing the no-duplication gate first.

## Production access note

`ssh goldplus-prod` is not available from this execution environment. Production/live
statuses above are carried from the newest handoff evidence (`NEXT_WORKTREE_README.md`,
`docs/platform/evidence/slices/`, 10-PR2G/10-D records) and are not re-verified this
session. Any claim requiring live verification is marked BLOCKED_EXTERNAL in the ledger.
