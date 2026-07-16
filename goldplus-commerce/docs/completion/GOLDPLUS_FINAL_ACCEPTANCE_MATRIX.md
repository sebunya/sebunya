# GoldPlus Final Acceptance Matrix (Slice 14B)

Release-candidate commit: `91e1e0a28c443950201857e60057fc591ef45446` · 2026-07-16
Statuses: SOURCE_COMPLETE (all vertical layers exist) · ACCEPTED_LOCAL (proven on the
local PostgreSQL 16 + API/web stack) · BLOCKED_EXTERNAL (exact requirement recorded).
Live status is NOT_DEPLOYED for everything after production head `bfa6de6`.

Legend for the proof columns: ✓ = evidence exists (file cited), ENV = requires an
environment capability this container lacks, OP = requires operator action.

| Slice | Module | UI | API | Domain | UseCase/Port | Repo | Schema/Mig | Perm | Audit | Focused tests | Browser tests | Runtime proof | Prod | Acceptance gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Verification harness | admin/system | health/metrics | governance | release/system | SystemHealth | — | reports.read | ✓ | arch 10/10 | admin redirect ✓ | fresh replay 0000→0028 ✓ | not re-verified (SSH) | image-start smoke (OP: docker daemon) |
| 1 | Auth/lockout | login/admin | auth.ts | LoginThrottle | AuthenticateUser+store | InMemory store | — | roles | login audit | 12 ✓ | logged-out redirect ✓ | 429+Retry-After live ✓ | behind | recovery = email delivery (OP) |
| 2 | Storefront | 87 pages | products/commerce | products/cart | list/detail | DrizzleProduct | products | products.* | ✓ | taxonomy+newsletter ✓ | home/shop/PDP ✓ both viewports | live list/PDP 200 ✓ | behind | — |
| 3 | Checkout/location/payment | checkout+admin zones | commerce+admin | Order/DeliveryFee/StateMachine | Checkout+zones+PesaPal | Drizzle{Order,Zone,Payment} | 0023 | pricing.manage, payments.* | ✓ | 36+6 ✓ | (API-level live) | forged-price/fee/idempotency live ✓; upgrade rehearsal ✓ | behind | PesaPal pending/failed states need sandbox creds (OP) |
| 4 | Search/demand | shop+admin/demand | suggest/events+admin | SearchService | 4 UCs | DrizzleSearchDemand | 0024 | reports.read, leads.assign | ✓ | 9 ✓ | zero-result CTA ✓ | demand row live ✓; queue lifecycle authed ✓ | behind | — |
| 5 | Compatibility | PDP+admin page | public+admin | Compatibility | 4 UCs | DrizzleCompatMapping | 0025 | products.write | ✓ | 10 ✓ | PDP section ✓ both viewports | declared→PDP live ✓ | behind | — |
| 6 | Recommendations | admin/recommendations | public+admin | rec services (25) | rules/preview | 4 repos | recs schema | recommendations.* | rule audit | suites ✓ | rails render on PDP ✓ | rules GET authed ✓ | behind | deeper authed rule-CRUD browser pass (OP optional) |
| 7 | Admin depth | 56 pages | 20+ admin routes | — | — | — | — | 29 perms | ✓ | truthful-state contract ✓ | redirect sweep ✓ | 403 for permissionless token ✓ | behind | per-page manual walkthrough (OP optional) |
| 8 | Loyalty (dormant) | admin/loyalty + account | admin+customer | LoyaltyLedger | gated UCs | DrizzleLoyalty | 0026 | settings.manage | ✓ (uuid fix 14E) | 9 ✓ | — | config PUT/GET live ✓; dormant truth ✓ | behind | commercial activation (OP) |
| 9 | Lifecycle/NBA | admin/lifecycle | governance | CustomerLifecycle | segments UC | LifecycleRead | — | reports.read | read-only | 4 ✓ | — | authed GET live ✓ (truthful zeros) | behind | messaging activation (OP) |
| 10 | Measurement/control room | admin pages | 5 route files | — | measurement UCs | measurement repos | 3 schemas | attribution.read | ✓ | 7 UAT ✓ | protection ✓ | 10-E crash fix live ✓ | 10-D NOT deployed | deployment approval (OP) |
| 11 | Support | support+admin inbox | governance | SupportTicket+SLA | inbox UCs | DrizzleSupport | 0027 | orders.manage | ✓ | 5 ✓ | — | create/SLA/assign/transition live ✓ | behind | customer sends (OP) |
| 12 | Legal | 5 policy pages+admin | — | registry lib | — | — | — | — | n/a | 6 ✓ | chips+support routing ✓ both viewports | — | behind | legal review sets dates (OP) |
| 13 | Quality | site-wide | — | — | — | — | — | — | n/a | static contract 5 ✓ | 12/12 Chromium desktop+mobile ✓ | bundle budgets ✓ | behind | Firefox/WebKit binaries + Lighthouse preview run (ENV) |
| 14 | Release | admin/release-readiness | release routes | — | release UCs | release infra | 0018-integrity ✓ | reports.read | ✓ | 14C tests 3 ✓ | — | fresh+upgrade+idempotency proofs ✓ | behind | image build + smoke (ENV: no docker daemon), then OP gates |
