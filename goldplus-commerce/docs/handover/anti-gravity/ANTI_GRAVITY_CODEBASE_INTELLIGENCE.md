# ANTI-GRAVITY CODEBASE INTELLIGENCE MODEL
Generated: 2026-07-21T07:30:00Z  
Worktree: `goldplus-commerce-next-phase-c1925dbd`  
Branch: `phase-2-measurement-control-tower-completion`  
HEAD: `30811fb4cbb3` (local = origin)

---

## 1. Repository / Workspace Structure

```
/goldplus-commerce/                   # monorepo root
  apps/
    api/                              # Hono Node.js API (TypeScript)
      src/
        config/                       # env.ts — centralised config loading
        domain/                       # 30 domain dirs (entities, VOs, policies)
        application/
          use-cases/                  # 175+ use cases across 30 domains
          ports/                      # 122 repository/service interfaces
          services/                   # measurement, consent, product-finder
          mappers/                    # DTO mappers
          recommendations/            # recommendation use cases
        infrastructure/
          db/
            client.ts                 # Drizzle + pg pool
            migrations/               # 0000–0048 (49 SQL files)
            repositories/             # 57 Drizzle repository implementations
            schema/                   # 37 schema files
          queues/
            QueueService.ts           # BullMQ singleton + queue definitions
            QueueWorkers.ts           # 5 registered worker consumers
          scheduler/
            OutboxTicker.ts           # 30-second outbox polling ticker
            RecommendationMaterializer.ts
            SyntheticMonitor.ts       # 5-min synthetic commerce check
          measurement/                # CDP destinations, attribution, GTM
          notifications/              # ZeptoMail, SMS, WhatsApp stubs
          outbox/                     # outbox repository
          payments/pesapal/           # PesaPal client adapter
          Registry.ts                 # COMPOSITION ROOT — singleton DI container
          ...
        interfaces/
          http/
            app.ts                    # Hono app — all route mounts
            server.ts                 # Entry point (serve + workers + tickers)
            middleware/               # auth, permissions, rateLimiter, maintenance, bot, session
            routes/                   # 50 route files (public + admin)
        presentation/
          routes/                     # 3 controlled-activation routes
        scripts/                      # 30+ proof/acceptance scripts
    web/                              # Astro SSR frontend
      src/
        pages/                        # 116 Astro pages (public + admin)
        components/                   # admin control tower, recommendations, etc.
        lib/catalog/                  # catalogue client with seed fallback
        layouts/                      # shared layouts
  packages/
    shared/                           # shared types, permissions, events
      src/
        permissions/index.ts          # 78 RBAC permission constants
        types/                        # ApiResponse, account, product, locations
        events/                       # consent, telemetry, zero-party events
  docs/
    completion/                       # 30+ completion matrices
    handover/                         # claude-fable, codex, anti-gravity states
    platform/
      releases/programme/             # release manifest, scope, runbook, UAT matrix
      evidence/                       # slice-by-slice proof artefacts
  scripts/                            # release scripts, QA, security
  tests/
    unit/                             # domain + use-case tests
    architecture/                     # boundary + domain-purity tests
    e2e/                              # Playwright acceptance
    uat/                              # measurement control tower UAT
  docker-compose.production.yml       # 10 services
  Caddyfile                           # edge proxy
  Dockerfile.api / Dockerfile.web
  pnpm-workspace.yaml
```

---

## 2. Build System

| Aspect | Detail |
|---|---|
| Package manager | pnpm 10.17.1 (workspace) |
| API build | `tsc` → `dist/` |
| Web build | Astro + Vite → `dist/` |
| Test runner | Vitest 1.6.1 |
| E2E | Playwright |
| Node version | 20.20.2 |

---

## 3. API Layer — Hono

### Entrypoint
`apps/api/src/interfaces/http/server.ts`
- Loads env + Sentry + OTEL
- Calls `serve(app.fetch)` on PORT (default 3000)
- Starts `OutboxTicker` + `registerAllWorkers()` (non-test env)
- Graceful shutdown: HTTP → OutboxTicker → DB → QueueService

### Composition Root
`apps/api/src/infrastructure/Registry.ts`
- Singleton instantiated on first `getInstance()` call
- Wires every repository → use case
- No lazy loading — all wired at startup

### Route Mounts (50 total after Anti-Gravity repair)
| Mount Path | Module |
|---|---|
| `/auth` | Authentication |
| `/products` | Product catalogue (public) |
| `/commerce` | Cart, checkout, orders, payments |
| `/governance` | Legal/policy |
| `/webhooks` | PesaPal IPN/callbacks |
| `/account` | Customer account |
| `/account/surveys` | Customer surveys |
| `/account/consent-operating` | Consent centre |
| `/account/behavioural-interventions` | Interventions |
| `/consent` | Consent management |
| `/measurement` | Telemetry collection |
| `/recommendations` | Recommendation engine |
| `/product-finder` | Product finder |
| `/telemetry` | Analytics events |
| `/health` | Health/liveness/readiness |
| `/metrics` | Prometheus metrics |
| `/admin/audit` | Audit log |
| `/admin/users` | Admin user management |
| `/admin/roles` | RBAC role management |
| `/admin/products` | Product admin |
| `/admin/notifications` | Notification admin |
| `/admin/recommendations` | Recommendations admin |
| `/admin/customer-dna` | Customer DNA admin |
| `/admin/decision-intelligence` | Decision Intelligence admin |
| `/admin/queues` | Queue admin |
| `/admin/deployment` | Deployment controls |
| `/admin/delivery-zones` | Delivery zones admin |
| `/admin/search-demand` | Search demand admin |
| `/admin/compatibility` | Compatibility admin |
| `/admin/loyalty` | Loyalty admin |
| `/admin/fulfilment` | Fulfilment admin |
| `/admin/inventory` | Inventory admin |
| `/admin/measurement` | Measurement overview |
| `/admin/measurement/gtm` | GTM admin |
| `/admin/measurement/paid-social` | **[REPAIRED by Anti-Gravity]** Paid social admin |
| `/admin/measurement/payments` | **[REPAIRED by Anti-Gravity]** Payment measurement admin |
| `/admin/measurement-control-tower` | Measurement Control Tower |
| `/admin/release-readiness` | Release readiness |
| `/admin/controlled-activation-dry-run` | Dry-run |
| `/admin/controlled-activation-live-review` | Live review |
| `/admin/controlled-activation/live-canaries` | Live canaries |
| `/admin/consent-operating` | Consent operating admin |
| `/api/admin/consent/operations` | Consent operations admin |
| `/admin/automation` | Automation admin |
| `/admin/experiments` | Experiments admin |
| `/admin/pricing` | Pricing admin |
| `/admin/fraud` | Fraud triage admin |
| `/admin/pim-imports` | PIM import admin |
| `/admin/surveys` | Surveys admin |
| `/admin/copy-quality` | Copy quality admin |
| `/admin/behavioural-interventions` | Behavioural interventions admin |

### Middleware Stack (applied globally)
1. CORS
2. Request ID / Trace Context
3. Pino structured logging
4. Rate limiter (1000/min global; 100/s telemetry; 10/min auth)
5. Maintenance mode gate
6. Shadow traffic mirror
7. Per-route: `authMiddleware` → `requirePermissions`

---

## 4. Web Layer — Astro SSR

### Entrypoint
`apps/web/src/pages/` — 116 Astro pages (SSR)

### Catalogue Client
`apps/web/src/lib/catalog/` — fetches live API; seed fallback only when API returns empty/unavailable.
**Catalogue parity invariant:** live API is authoritative. Seed is never prepended to live data.

### Admin Surface
81 Astro pages under `apps/web/src/pages/admin/`

---

## 5. Domain Layer (30 domains)

| Domain | Key Entities |
|---|---|
| advertising | Attribution events |
| audit | AuditLog |
| automation | Automation, AutomationAction, ExecutionPlan |
| behavioural-interventions | BehaviouralIntervention |
| cart | Cart, CartLine |
| cms | Content |
| commerce | Order, Payment |
| consent | ConsentRecord, ConsentChannel |
| copy-quality | CopyQualityReport |
| customer-dna | CustomerDna, CustomerStage |
| dealers | Dealer |
| decision-intelligence | DecisionInsight, NbaResult |
| experiments | Experiment, ExposureRecord |
| fakeReports | FakeReport (non-operational) |
| fraud | FraudTriage |
| fulfilment | FulfilmentTask, FulfilmentLine, Dispatch, Delivery |
| governance | Policy, LegalRecord |
| identity | AdminUser, CustomerAccount |
| inventory | InventoryRecord, Reservation |
| loyalty | LoyaltyLedger, LoyaltyPoints |
| notifications | NotificationAttempt, OutboxEvent |
| orders | Order, OrderLine |
| payments | PaymentAttempt, PesaPalCallback |
| pim | PimImport, PimMapping |
| pricing | PricingRule, PricingCapacity, PricingQuote |
| products | Product, Category, Brand, Attribute |
| quotes | Quote |
| recommendations | RecommendationEvent, RecommendationRule |
| support | SupportTicket, SlaEvent |
| surveys | Survey, SurveyResponse |
| verification | VerificationRecord |

---

## 6. Infrastructure — Database

### PostgreSQL / Drizzle
- Client: `apps/api/src/infrastructure/db/client.ts`
- Migrations: `apps/api/src/infrastructure/db/migrations/` (49 SQL files, 0000–0048)
- Schema: 37 schema files (`apps/api/src/infrastructure/db/schema/`)
- Repositories: 57 Drizzle implementations

### Migration ceiling: `0048_search_insights.sql`

---

## 7. Infrastructure — Queues / Workers

### BullMQ via Redis
Queue definitions in `QueueService.ts`:
```
TELEMETRY_DISPATCH     → outbox telemetry events
TELEMETRY_REPLAY       → (defined, no dedicated worker — handled by batch)
WEBHOOK_RETRIES        → PesaPal callback retries
RECOMMENDATION_PROCESSING → recommendation event persistence
ANALYTICS_FANOUT       → synthetic monitor + recommendation materialiser (cron)
INVENTORY_SYNC         → (defined, worker registered in QueueWorkers)
EMAIL_JOBS             → notification outbox batch trigger
ABANDONED_CART_EVENTS  → (defined)
RECOMMENDATION_MATERIALIZATION → (defined)
```

### 5 Registered Workers
1. `TELEMETRY_DISPATCH` — dispatches telemetry events through outbox
2. `WEBHOOK_RETRIES` — retries PesaPal IPN processing
3. `EMAIL_JOBS` — triggers notification outbox batch
4. `RECOMMENDATION_PROCESSING` — persists recommendation events
5. `ANALYTICS_FANOUT` — synthetic commerce check + recommendation materialisation cron

### Cron Jobs (started in `ANALYTICS_FANOUT` queue)
- `*/5 * * * *` — synthetic commerce check
- `0 * * * *` — recommendation materialisation

### Tickers
- `OutboxTicker.ts` — 30-second polling, processes outbox batch
- `RecommendationMaterializer.ts` — hourly materialisation (also triggered by cron)
- `SyntheticMonitor.ts` — 5-minute commerce parity check

---

## 8. Infrastructure — Payments (PesaPal)

Adapter: `apps/api/src/infrastructure/payments/pesapal/`  
Port: `IPesaPalClient.ts`  
Safety: PesaPal amount always derived from committed order; callback cannot mutate price.  
IPN: `/webhooks` route handles callbacks with signature verification.

---

## 9. Infrastructure — Measurement / CDP

Destinations registered in `PaidSocialDestinationMapperRegistry`:
- Meta CAPI
- TikTok Events
- X Conversion
- LinkedIn Conversion
- Pinterest Conversion
- Snapchat Conversion
- Google Ads
- PostHog

All pass through consent gate → route → payload prepare → deliver → DLQ.  
Zero provider call in dry-run mode.

---

## 10. Infrastructure — Notifications

Providers:
- ZeptoMail (email) — `NOTIFICATIONS_EMAIL_ENABLED` gate
- SMS — `NOTIFICATIONS_SMS_ENABLED` gate
- WhatsApp — stub infrastructure (not live)

`SENT` status only written after confirmed provider success.  
`NOTIFICATIONS_DRY_RUN=true` and `NOTIFICATIONS_LIVE_SEND_ENABLED=false` are the safe defaults.

---

## 11. Authentication / RBAC

- JWT-based auth middleware (`middleware/auth.ts`)
- 78 permission constants in `@goldplus/shared`
- `requirePermissions` middleware enforces per-route RBAC
- Admin auth at `/auth/admin/login` with rate limiting (10/min)
- Customer auth at `/auth/login` with rate limiting (10/min)
- Login lockout implemented (Slice 1B)

---

## 12. Observability

- Pino structured logging (`infrastructure/logging/logger.ts`)
- OpenTelemetry (`infrastructure/observability/otel.ts`)
- Sentry error tracking
- Prometheus metrics (`/metrics` endpoint)
- prom-client: queue job wait/duration histograms, DB query durations, event loop lag
- PgHero for DB observability
- Grafana + Prometheus in Compose

---

## 13. Production Runtime (docker-compose.production.yml)

| Service | Role |
|---|---|
| `api` | Hono API, 2 replicas, health `/health/live` |
| `web` | Astro SSR, 2 replicas, health port 4321 |
| `caddy` | Edge proxy, TLS termination |
| `postgres` | PostgreSQL (external managed) |
| `redis` | BullMQ backing store |
| `pghero` | DB observability dashboard |
| `prometheus` | Metrics collection |
| `grafana` | Metrics visualisation |
| `node-exporter` | Host metrics |
| `sgtm-production` | Server-side GTM |
| `sgtm-preview` | GTM preview server |

---

## 14. Release / Rollback

Release manifest: `docs/platform/releases/programme/GOLDPLUS_PROGRAMME_RELEASE_MANIFEST.json`  
Rollback matrix: `docs/platform/releases/programme/GOLDPLUS_PROGRAMME_ROLLBACK_MATRIX.md`  
Deployment runbook: `docs/platform/releases/programme/GOLDPLUS_PROGRAMME_DEPLOYMENT_RUNBOOK.md`

---

## 15. Test Architecture

| Layer | Files | Tests |
|---|---|---|
| Unit (domain + use-case) | ~180 | ~3,900 |
| Architecture (boundary + purity) | 2 | 10 |
| E2E (Playwright) | 2 | 12+ |
| UAT (measurement control tower) | 8 | ~240 |
| **Total** | **217** | **4,144** |
