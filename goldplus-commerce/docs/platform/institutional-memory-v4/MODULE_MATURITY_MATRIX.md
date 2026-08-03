# Module maturity matrix — reconciliation rows (gap-only contract, F7)
SHA `473ede0` · 2026-08-03. Sources: live capability matrix (docs/production-recovery/2026-08-03-platform-wide/MODULE_CAPABILITY_MATRIX.md), the 7 recon indexes in this directory, and the do-not-break ledger. CLASSIFICATION vocabulary: KEEP / HARDEN / MERGE / BUILD_GAP_ONLY / REPLACE_WITH_PROOF / DEPRECATE_WITH_PROOF / EXTERNAL. States: WORKING / TRUTHFULLY_EMPTY / PROTECTED_BY_POLICY / DORMANT_BY_BUSINESS_DECISION / EXTERNAL_BLOCKED.

## Core commerce (conflict group CORE_COMMERCE)
| Module | Current state | Classification | Gap → chosen action |
|---|---|---|---|
| Storefront (home/shop/PDP/finder) | WORKING (live-verified) | KEEP | regression protection only (route-contract) |
| Cart (server, BFF credential) | WORKING (RC-3..7 fixed; 180d retention this programme) | HARDEN → done S2 | ✅ 180d single constant; unit suite S3; residual: local-cookie fallback dual-path — deliberate resilience, keep, documented |
| Checkout + payment verification | WORKING (server-side pricing, idempotent webhooks) | KEEP | preserved; synthetic write journey stays DORMANT in prod |
| Orders admin | WORKING (page+API 200) | HARDEN (later phase) | §12 control-tower actions (verify/assign/hold/refund with reason+audit) not yet built — BUILD_GAP_ONLY when scheduled |
| Fulfilment | WORKING (list/badge/SLA endpoints live) | HARDEN (later) | §14 batch/pick/pack workflow missing |
| Inventory | WORKING (page 200) | HARDEN (later) | §16 ledger/adjustment UI partial |
| Fraud | WORKING (page 200) | HARDEN (later) | §13 workbench actions partial |
| Order communications | PARTIAL (email outbox exists: ADMIN_ORDER_EMAIL) | HARDEN (later) | §15 template editor/versioning missing |

## Access & governance (ADMIN_LEGAL_ACCESS)
| Module | Current state | Classification | Gap → chosen action |
|---|---|---|---|
| Permission registry + enforcement | WORKING (84 constants, 271 guarded routes, 2 step-up MFA) | KEEP + HARDEN → done S1 | ✅ code-driven idempotent sync (advisory-locked, add-only, audited); 14 constants guard no route — recorded, business wiring later |
| Role model | Was: single Owner via out-of-band SQL | HARDEN → done S1 | ✅ PLATFORM_ADMINISTRATOR full-grant + 10-role vocabulary (empty by policy decision) + bootstrap-admin assignment. Remaining §6: maker/checker grant flow, MFA surfacing, access review UI — BUILD_GAP_ONLY later |
| Controlled activation (live-review) | Was: fail-closed DEAD (no auth chain) | HARDEN → done S6 | ✅ revived with auth + method-shaped permission gate |
| Audit | WORKING | KEEP | S1 writes system audit rows |
| Legal pages | Static (registry) | BUILD_GAP_ONLY (§7 CMS) — later phase | large build; not started |

## Catalogue & content (CATALOGUE_DAM_PIM)
| Module | Current state | Classification | Gap |
|---|---|---|---|
| Products/categories/PIM imports | WORKING (U-programme) | KEEP | §10 control-room UX depth later |
| DAM/images | NOT BUILT (catalogue URLs only) | BUILD_GAP_ONLY (§8) — later phase | large build |
| SEO/redirects | WORKING (U6 backend) | KEEP | — |
| Reviews moderation | WORKING | KEEP | review_media/votes tables orphaned — wire or defer |

## Growth & intelligence (CUSTOMER_MARKETING / RECOMMENDATIONS_MERCHANDISING)
| Module | Current state | Classification | Gap |
|---|---|---|---|
| Recommendations engine | WORKING (canonical strength; hourly materializer cron) | KEEP | §18-20 rules/analytics/preview depth later |
| Merchandising | WORKING (page 200) | HARDEN later | §21 homepage workspace |
| Customer DNA | WORKING (live endpoints 200) | KEEP | §24 depth later |
| Decision intelligence | WORKING | KEEP | — |
| Campaigns | SCHEMA ONLY (campaigns/utm_links tables orphaned — no reader/writer) | BUILD_GAP_ONLY (§26) — later, no-send design first | honest state: not a module yet, do not present as one |
| Automation | WORKING (AUTOMATION_ACTION_REQUESTED outbox type + admin surface) | HARDEN later | §27 workflow builder |
| Loyalty | PARTIAL (3 tables, U-programme backend) | HARDEN later | §32 activation gated |
| Abandoned carts | QUEUE DECLARED, NO WORKER (abandoned-cart-events) | BUILD_GAP_ONLY (§11 tail) later | wire worker + consent-gated segments |

## Measurement & consent (MEASUREMENT_CONSENT_ATTRIBUTION)
| Module | Current state | Classification | Gap |
|---|---|---|---|
| Measurement control tower + DLQ | WORKING (telemetry_dlq replayable, partitioned outbox) | KEEP | provider delivery = EXTERNAL_BLOCKED without credentials |
| Consent | WORKING | KEEP | — |
| Attribution | WORKING (foundations) | HARDEN later | §30 models depth |
| sGTM | RUNNING (2 containers) | KEEP | preview-server config unverified — check at release |

## Platform infra (PLATFORM_INFRA_RELEASE)
| Module | Current state | Classification | Gap |
|---|---|---|---|
| Compose/Caddy/topology | WORKING (RC-4 pinned) | KEEP | pgbouncer unused by API — deliberate follow-up decision, NOT a defect |
| Queues/workers/outbox | WORKING (9 queues; 4 declared without worker/producer: telemetry-replay, inventory-sync, abandoned-cart-events, recommendation-materialization*) | HARDEN later | wire or prune declared-only queues (*materialization runs via cron on analytics-fanout) |
| Synthetic monitor | read=WORKING, write=DORMANT_BY_BUSINESS_DECISION | KEEP | — |
| Orphaned tables (36) | schema without code | recorded | per-table decision when its module is scheduled; never silently drop |

## Engineering-complete this session: S1, S2, S3, S6 (+ this memory kernel). Released: pending S5 roll at `473ede0`.

## Wave 2 updates (2026-08-03, continuation)
| Module | Was | Now | Evidence |
|---|---|---|---|
| Measurement control tower (page) | BROKEN (silent SERVICE_UNAVAILABLE behind 200 — rogue env var + cookie auth to Bearer-only API) | WORKING (RELEASED 8d06197) | live render of data panels |
| Web nav integrity | 3 dead links (2 customer-facing PDP) | WORKING + architecture-guarded | nav-resolution test green |
| Web→API contract | unverified | 100% of ${apiBase} calls target mounted prefixes, architecture-guarded | mapping test green |
| DAM / media library | NOT BUILT + storage write-only black hole in prod | ENGINEERING GREEN (d074c36), releasing: durable volume + edge serving + library (dedup, metadata, variants best-effort, usage graph, safe delete, assign-to-product repair, picker) | unit 4/4, arch 101/101 |
| Product image repair | impossible (no storage, no tooling) | UNBLOCKED: missing-images worklist + assign flow; actual photography = operator task | /admin/media |
Remaining INCOMPLETE_INTERNAL_GAP (unchanged this wave): legal CMS §2C, PIM control room §2D, capability hub §2D, abandonment pipeline §2E, order/fraud/fulfilment/comms/inventory/pricing actions §2E, campaigns §2F, automation depth §2F, analytics depth §2G, loyalty/gamification §2H.

## Wave 2C/2D/2E-1 updates (2026-08-03 evening)
| Module | Was | Now | Evidence |
|---|---|---|---|
| Legal CMS | NOT BUILT (static registry + hardcoded bodies) | WORKING (RELEASED 5c15118): 12 policies, draft→review→approve(maker/checker, live-403-proven)→publish/schedule(lazy)→rollback-by-repoint; public pages render PUBLISHED with truthful static fallback | live E2E |
| /admin/legal static page | read-only registry table | DEPRECATED_WITH_PROOF (zero inbound links; superseded by CMS workspace) | 86-page sweep green |
| Abandonment pipeline | queue declared, no producer/worker, no definition | WORKING v1 (RELEASED 3daa238): cart_abandonments single definition, hourly evaluator cron (3rd repeat job in redis), queue alive producer+worker, admin read surface; RECOVERED deferred honestly (no checkout↔cart linkage exists) | endpoint 200, redis zcard 3 |
| Capability hub | generic modules page | WORKING (9709116, rolling): honest-counts hub cards + truthful INCOMPLETE_INTERNAL_GAP labels + workspace links; working sections preserved below | arch 101/101 incl. nav-link guard |
Remaining INCOMPLETE_INTERNAL_GAP: PIM control-room depth, order/fraud/fulfilment/comms/inventory/pricing ACTIONS, campaign engine, automation workflow builder, analytics/recommendation-analytics depth, search/visitor intelligence depth, loyalty activation, gamification, DAM real-photo repair (operator), reviewer account for legal publishing (§6 user management).
