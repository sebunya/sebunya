# GoldPlus 0–14 Master Ledger — Implementation Truth Matrix

Slice 14A ELITE reconciliation. Source of truth: branch
`phase-2-measurement-control-tower-completion` @ `4b4016c`, 2026-07-15.
Production/live column carries newest handoff evidence (production at `bfa6de6`);
live re-verification is BLOCKED_EXTERNAL in this environment (no `ssh goldplus-prod`).

Statuses: LIVE_VERIFIED · SOURCE_COMPLETE_NOT_DEPLOYED (SCND) · PARTIAL_VERTICAL ·
STATIC_UI_ONLY · BACKEND_ONLY · SHELL_OR_PLACEHOLDER · MISSING · BLOCKED_EXTERNAL ·
UNSAFE_OR_REGRESSED

| Slice | Module | UI | API | Use case | Domain | Port | Repo | Table/migration | Permission | Audit | Tests | Prod/live | Status | Missing vertical layers | Duplicate-risk | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Protection & verification | admin release/system pages | health, metrics, release-readiness | release, system | governance | release ports | SystemHealth | release_readiness | reports.read | yes | 2 arch suites + protected 700/700 (evidence) | live checks pass per 10-PR2G | SCND | production re-verification from this env | none | keep gates green; re-verify when SSH available |
| 1 | Owner access / auth | login, account, admin users/roles/access | auth.ts, admin users/roles | identity | identity | IIdentityRepository, IUserRepository, IRoleRepository, IPasswordHasher, ITokenSigner | Drizzle{Identity,User,Role} | identity.ts | auth.manage, roles.manage, permissions.manage | yes | unit auth suites | LIVE (evidence) | SCND | none proven; residual audit of recovery/lockout depth | none | regression tests only where weak |
| 2 | Storefront P0 | 84 pages (shop, PDP, cart, compare, finder, verify, track-order) | products, commerce | products, commerce | products, cart | IProductRepository etc. | DrizzleProduct etc. | products.ts, commerce.ts | products.* | yes | unit suites | LIVE (evidence) | PARTIAL_VERTICAL | taxonomy coverage check, newsletter truthful state, mobile QA matrix | none | targeted residual audit |
| 3 | Checkout / location / payment | checkout.astro, checkout/pesapal/*, admin/pricing/delivery-zones | commerce, webhooks, admin/delivery-zones | Checkout (server-authoritative, Slice 3B), DeliveryZoneAdmin, StartPesaPalPayment, VerifyPesaPalPayment, RecordPaymentWebhook | PaymentStateMachine, PaymentIdempotencyService, DeliveryFee | IPesaPalClient, IPesaPal/IPayment repos, IDeliveryZoneRepository | DrizzlePayment{,Attempt}, DrizzleDeliveryZone | commerce.ts + migration 0023 | payments.confirm/read, pricing.manage | yes | payment suites + Slice03B (12) | LIVE at bfa6de6; 3B source-only | PARTIAL_VERTICAL | admin payment ops depth, reconciliation view | LOW — extend, never duplicate state machine | admin payment ops residual |
| 4 | Search / autocomplete / zero-result | shop.astro search, product-finder | products.ts (`search: q`) | ProductSearchService, CreateLeadUseCase | products | IProductRepository | DrizzleProduct | products.ts | products.read, leads.assign | partial | search unit | LIVE (evidence) | PARTIAL_VERTICAL | autocomplete endpoint, zero-result event capture, admin demand queue | LOW — extend ProductSearchService | after Slice 3 |
| 5 | Compatibility | none (PDP lacks selector) | via recommendations | CompatibilityRuleService | recommendations | IRecommendationRuleRepository | DrizzleRecommendationRule | recommendations.ts | recommendations.manage | yes | rule unit tests | n/a | PARTIAL_VERTICAL | device/product model, exact/conditional/incompatible states, PDP selector, admin CRUD beyond rec rules | MEDIUM — must extend CompatibilityRuleService, not fork | boundary decision then extend |
| 6 | Recommendations | admin/recommendations/ pages + shelves | /recommendations + /admin/recommendations | 25 modules: rules CRUD+preview+conflict+eligibility+diversity+fallback+analytics+events | recommendations | IRecommendationRule/Analytics/Event/Reader | 4 Drizzle repos | recommendations.ts | recommendations.read/manage | yes (rule audit log) | rule/preview/conflict suites | source newer than prod | SCND | live verification; minor UX depth | HIGH — parallel module preserved on claude/goldplus-debug-features-8ku4ns; DO NOT port | leave; extend only via existing rule system |
| 7 | Admin depth | 51 admin pages | 18 admin route files | admin use-cases | — | admin read ports | admin repos | — | 29 permissions | yes | partial | LIVE (evidence) | PARTIAL_VERTICAL | per-page truthful states (loading/empty/error/not-configured), permission-aware actions audit | none | page-by-page audit slice |
| 8 | Loyalty | loyalty.astro + admin/loyalty.astro (truthful disabled state, guardrails) | none | none | none | none | none | none | none | n/a | guardrail constants | LIVE truthful placeholder | STATIC_UI_ONLY (deliberate) | wallet, ledger, earn/burn, reversal, expiry, idempotency, admin config — all feature-gated | LOW — a ledger existed on old branch only; build fresh here behind flags | feature-gated vertical; no commercial activation |
| 9 | Customer DNA / NBA / lifecycle | preferences.astro | consent, preferences | consent, preferences | consent | consent/preferences ports | consent repos | consent*.ts, preferences.ts | — | yes | consent suites | consent LIVE | MISSING (NBA/lifecycle) on top of LIVE consent/preference foundations | unified profile, lifecycle states, segments, deterministic NBA, suppression | MEDIUM — must reuse consent/preferences, no second profile store | design on existing signals |
| 10 | Measurement / control tower | admin/measurement*, control-tower, external-delivery pages | 5 measurement route files + control tower | measurement use-cases | — | measurement ports | Drizzle measurement repos (consent, attribution, DLQ, destinations) | measurement*.ts ×3 | attribution.read | yes | 7 UAT suites + unit | control room ready; 10-D NOT deployed | SCND + BLOCKED_EXTERNAL (deploy approval) | production deployment + post-deploy verification | none | await operator-approved image build/recreate |
| 11 | Support / WhatsApp readiness | support/index, issue, admin/support | governance.ts | OpenSupportTicketUseCase | SupportTicket | ISupportRepository | DrizzleSupportRepository | governance.ts | — | partial | partial | customer flow LIVE (evidence) | PARTIAL_VERTICAL | admin inbox, assignment, status/SLA, order link/timeline, template registry+approval, allowlist, automation | LOW — extend SupportTicket | after Slices 3–5 |
| 12 | Legal / warranty / returns | privacy.astro, terms.astro | none | none | none | none | none | none | none | n/a | none | LIVE (pages) | PARTIAL_VERTICAL | returns, warranty, cookie/consent page, versioning/effective dates, claims flows, admin ops | none | content + versioning slice |
| 13 | Perf / accessibility / cross-browser | site-wide | — | — | — | — | — | — | — | n/a | Playwright configured | evidence in docs | PARTIAL_VERTICAL | Lighthouse baseline, budgets, WCAG 2.2 AA matrix, 3-engine responsive matrix | none | verification matrix slice |
| 14 | Release engineering | admin/release-readiness.astro | release-readiness routes | release use-cases | — | release ports | release infra | release_readiness.ts | reports.read | yes | protected release-gate suites | deployment approval-gated | SCND + BLOCKED_EXTERNAL (10-D deploy) | master release manifest freshness; post-deploy checks | none | maintain; execute on approval |

## External blockers (do not fabricate)

1. **10-D production deployment** — requires operator-approved maintenance window with
   reproducible API/web image build + scoped `up -d --no-deps api web`. Marker files are
   operator-created only. Status: BLOCKED_EXTERNAL.
2. **Live verification from this environment** — no `ssh goldplus-prod` binary/alias in
   the remote container. All live claims are evidence-carried, not re-verified.
3. **Provider/customer delivery** — all delivery flags default false; activation needs
   separate operator approval. Status: BLOCKED_EXTERNAL.

## Priority queue (per protocol §15)

1. Slice 3 residuals: Uganda location hierarchy + delivery fees + admin payment ops
2. Slice 4 residuals: autocomplete + zero-result demand capture
3. Slice 5: compatibility boundary decision + PDP guidance
4. Slice 7: admin depth/readability audit
5. Slice 8: feature-gated loyalty ledger
6. Slice 9: consent-bound lifecycle/NBA
7. Slice 11: support admin inbox vertical
8. Slice 12: legal/returns/warranty
9. Slice 13: perf/accessibility matrix
10. Residual closure 0/1/2/6/10/14
