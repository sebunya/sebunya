# GoldPlus Refactor Audit

Date: 2026-06-02

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, read-only audit only.

## Repository Orientation

- Actual root: `GoldPlusFinal/goldplus-commerce`.
- Remote: `git@github.com:sebunya/sebunya.git`.
- Active branch: `phase-1-functional-depth`.
- Package manager: pnpm workspace, packages declared in `pnpm-workspace.yaml`.
- Workspace apps: `apps/api`, `apps/web`, `packages/shared`.
- API: Hono, Drizzle ORM, PostgreSQL, Redis/BullMQ, PesaPal, notifications, telemetry, Sentry, OpenTelemetry, Prometheus.
- Web: Astro server output, Node adapter, Tailwind, Sentry, PostHog, service worker.
- Deployment: `docker-compose.production.yml`, `Dockerfile.api`, `Dockerfile.web`, `Caddyfile`, Caddy, PostgreSQL, PgBouncer, Redis, Prometheus, Grafana, node-exporter, sGTM.
- Current worktree: dirty before this audit. Existing modified/untracked files include deployment files, observability/telemetry files, recommendation files, migration files, and tests. This audit did not revert or modify those files.

## Scripts And Gates

- `pnpm lint`: failed. One error in `apps/web/src/lib/telemetry.ts` for `prefer-const`; 26 warnings.
- `pnpm run typecheck`: passed.
- `pnpm test:architecture`: passed, 10 tests.
- `pnpm test:unit`: failed. `tests/unit/Observability.test.ts` timed out on `GET /metrics`.
- `pnpm test`: failed on the same `/metrics` timeout. 384 passed, 1 failed.
- `pnpm run build`: passed for API and web. Sentry integration warnings were emitted.
- `pnpm audit --audit-level=high`: failed. 24 vulnerabilities: 1 critical, 5 high, 15 moderate, 3 low.

## Top 20 Refactor Findings

| Severity | Finding | File path | Current problem | Risk | Recommended fix | Blast radius | Tests required |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Critical | Caddy and web startup depend on API health | `docker-compose.production.yml:151`, `docker-compose.production.yml:201` | Web waits for API healthy; Caddy waits for both web and API healthy. | One API env or DB failure can collapse storefront availability and TLS edge startup. | Decouple Caddy from API, let web serve static/degraded pages, route API failures independently. | Deployment and reverse proxy. | Compose config validation, smoke test with API intentionally down, Caddy route tests. |
| Critical | Host port conflict | `docker-compose.production.yml:70`, `docker-compose.production.yml:243` | API and Grafana both publish host port `3000`. | Compose startup conflict or wrong service exposed. | Move Grafana to `127.0.0.1:3001:3000` or remove public bind. | Deployment only. | Docker compose config, production smoke. |
| Critical | Unauthenticated governance admin reads | `apps/api/src/interfaces/http/routes/governance.ts:147`, `apps/api/src/interfaces/http/routes/governance.ts:385` | Several `/governance/admin/*` reads have no auth or permission middleware. | Product, payment, quote, support, dealer, and aggregate data can be exposed. | Add auth and least-privilege permissions to every admin read endpoint; update SSR fetches to forward token. | Backend routes and admin SSR. | Security route tests for 401/403 and authorized success. |
| High | Admin SSR helper omits auth token | `apps/web/src/lib/api.ts:14` | `tryFetchAdminList` fetches admin data with no Authorization header. | Encourages unauthenticated API endpoints to make admin pages work. | Add token-aware admin fetch helper and update pages incrementally. | Admin web pages. | SSR admin page tests and API auth tests. |
| High | Metrics endpoint depends on live Redis queue calls | `apps/api/src/interfaces/http/routes/metrics.ts:136` | `/metrics` loops BullMQ queues and awaits counts; tests time out without Redis. | Observability endpoint can hang and fail monitoring when Redis is unhealthy. | Make queue metrics bounded with timeout/non-blocking cached values. | Metrics route, QueueService. | `Observability.test.ts`, Redis-down metrics test. |
| High | Request ID middleware is registered after routes | `apps/api/src/interfaces/http/app.ts:90`, `apps/api/src/interfaces/http/app.ts:114` | Tracing/request ID middleware comes after route registration. | Route handlers and earlier middleware may miss correlation context. | Move request ID/tracing middleware before routes and before logging-dependent middleware. | HTTP app wiring. | Route response header tests, logging correlation tests. |
| High | Application layer imports infrastructure | `apps/api/src/application/use-cases/telemetry/TrackBrowserTelemetryEventUseCase.ts:1` | Use cases import db, schema, repository, logger directly. | Lower testability and Clean Architecture boundary erosion. | Introduce telemetry outbox and identity ports; inject adapters via registry. | Telemetry and tests. | Telemetry unit/integration tests, architecture tests tightened. |
| High | Architecture tests codify exemptions | `tests/architecture/boundaries.test.ts` | Known application-infrastructure leaks are skipped. | Architecture drift can become permanent. | Convert exemptions into explicit TODO fitness checks with migration plan. | Tests only at first. | Architecture tests. |
| High | Dependency audit has critical/high advisories | `package.json`, `apps/api/package.json`, `apps/web/package.json` | Vitest, Astro, Drizzle, xlsx, devalue vulnerable per `pnpm audit`. | Security and CI exposure. | Upgrade in a dedicated dependency pass with lockfile diff review. | Dependencies and lockfile. | Full gates plus smoke tests. |
| High | Production env validation is strict at API import/startup | `apps/api/src/config/env.ts:126` | Missing core env throws before API starts. | Secure, but can cascade into web/Caddy outage under current compose. | Keep strict validation, but decouple edge/static services and add preflight deploy checks. | Deployment workflow. | Env validation tests, compose degraded-start tests. |
| High | CORS is open | `apps/api/src/interfaces/http/app.ts:41` | `cors()` has no origin restrictions. | Browser-callable public/admin API surface is broader than necessary. | Restrict origin by environment, keep webhook/server routes explicit. | API middleware. | CORS integration tests. |
| Medium | Route files remain fat | `apps/api/src/interfaces/http/routes/commerce.ts`, `apps/api/src/interfaces/http/routes/admin/products.ts` | Routes contain validation, orchestration, fallback behavior, and domain decisions. | Harder to test and maintain. | Extract request DTO validation and use cases one route group at a time. | Backend route groups. | Unit tests for extracted validators/use cases, route contract tests. |
| Medium | Checkout offline draft path can confuse production users | `apps/web/src/pages/checkout.astro:138` | Local draft flow exists when API is unavailable. | Users may believe checkout progressed even when no server order exists. | Gate local draft mode behind explicit non-production flag or stronger production copy. | Checkout UX. | Checkout SSR tests, UX review. |
| Medium | Service worker has no API/catalog cache strategy | `apps/web/public/sw.js:48` | Navigations fall back to `/offline`; no static catalog fallback beyond app code. | Offline storefront experience depends on SSR fetch fallbacks and navigation cache. | Define production-safe static/catalog cache policy without caching sensitive routes. | Web public assets. | Service worker tests, offline smoke. |
| Medium | Footer references missing payment asset | `apps/web/src/layouts/BaseLayout.astro:258` | `/payment/airtel-money.svg` is referenced but not present. | Broken image in footer. | Add asset or remove reference in a small frontend pass. | Web layout. | Build plus visual smoke. |
| Medium | Lint is not green | `apps/web/src/lib/telemetry.ts` | One `prefer-const` error blocks `pnpm lint`. | CI failure and lower confidence. | Fix the single lint error; triage warnings separately. | One TS file. | `pnpm lint`. |
| Medium | Astro templates are not fully checked by typecheck script | `apps/web/package.json` | `tsc --noEmit` does not provide full `.astro` checking. | Template errors can pass CI. | Add `astro check` with required dependency if acceptable. | Web tooling. | CI typecheck update. |
| Medium | Metrics and health instantiate broad Registry | `apps/api/src/interfaces/http/routes/health.ts:27`, `apps/api/src/interfaces/http/routes/metrics.ts:108` | Diagnostic endpoints can instantiate payment, notification, recommendation, storage, and queue adapters. | Health checks become coupled to unrelated subsystems. | Introduce narrow health registry or health-specific ports. | Health/metrics. | Health route tests with DB/Redis down. |
| Low | Tailwind token aliases preserve old naming | `apps/web/tailwind.config.mjs` | Back-compat aliases like `gold` map to primary. | Low risk, but visual vocabulary is less clear. | Leave stable now; clean only with visual regression. | Web CSS. | Visual smoke. |
| Low | Generated docs and previous pass reports are numerous | `docs/` | Hard to find canonical runbooks and audits. | Developer velocity issue. | Add docs index after refactor docs are approved. | Docs only. | None beyond review. |

## Executive Risk Summary

The production outage pattern is plausible from current configuration. The API is strict about core env, which is correct for security. The unsafe part is deployment coupling: web and Caddy depend on API health. If API fails validation, DB, Redis, or health checks, the storefront edge can disappear rather than degrade.

The highest security risk is unauthenticated admin read data under `/governance/admin/*`. The frontend currently fetches some of these endpoints without Authorization. Fixing this requires backend route protection and frontend token forwarding in the same small pass.

The highest architecture risk is not one class, but boundary erosion: route files and telemetry use cases reach into infrastructure directly, while the Registry is a broad singleton. That should be improved gradually with ports and route-contract tests.

## Approval Gate

Do not edit production code until an implementation pass is approved. Recommended first pass: fix non-behavioral CI blockers and security route tests, but do not touch protected recommendation logic.

## Pass 1 Verification Note - 2026-06-02

Protected systems touched: NO.

Approved Pass 1 scope was implemented only in `apps/web/src/lib/telemetry.ts`, `apps/api/src/interfaces/http/routes/metrics.ts`, `tests/unit/Observability.test.ts`, and the approved refactor docs. The web `prefer-const` error is fixed. `/metrics` now preserves the existing Prometheus metric names while bounding optional DB and BullMQ collection, exposing degraded-state collection metrics, and returning process/Prometheus metrics when optional dependencies are unavailable.

Verification completed: `pnpm test:unit -- tests/unit/Observability.test.ts` passed; because of current script behavior it ran all unit tests, 55 files and 375 tests. `pnpm test:architecture` passed, 10 tests. `pnpm --filter @goldplus/web lint` passed with 0 errors and existing warnings. Targeted API route lint passed with 0 errors. Full `pnpm lint` remains blocked by existing API lint errors outside Pass 1 scope.

## Pass 1B Verification Note - 2026-06-02

Protected systems touched: NO.

Approved Pass 1B scope was implemented only in the six approved API lint-error files and the approved refactor docs. The 12 remaining blocking API lint errors were fixed with semantic no-op changes: `prefer-const`, bounded retry loop condition spelling, unnecessary regex escape removal, and replacing local `require()` usage in `QueueService.ts`.

Verification completed: `pnpm lint`, `pnpm run typecheck`, `pnpm test:architecture`, `pnpm test`, `pnpm run build`, and `pnpm test:unit` all passed. Existing lint warnings remain non-blocking, and build still emits existing Sentry/Vite warnings. Recommended Pass 2 remains Production Availability Isolation, pending explicit approval.

## Pass 2 Planning Checkpoint - 2026-06-02

Protected systems touched: NO.

Pass 2 planning only was completed for Production Availability Isolation. No production code, Docker/Caddy config, env, service worker, package, lockfile, test, deployment script, or migration file was changed. Planning notes were appended to `implementation-plan.md`, `risk-matrix.md`, and `deployment-reliability-audit.md`.

Implementation is ready for approval review, but not started. The proposed implementation isolates Caddy startup, adds Caddy-level fallback behavior, breaks web startup dependency on API health, resolves the API/Grafana host port conflict, and aligns verification around `/health/live`, `/health/ready`, `/health/deep`, `/metrics`, and TLS validity.

## Pass 2 Implementation Checkpoint - 2026-06-03

Protected systems touched: NO.

Pass 2 implementation was completed only in the approved deployment, Caddy fallback, and documentation files. Production code, API env validation, web application code, service worker behavior, checkout, payment, notification, recommendation systems, telemetry fanout, server-side GTM behavior, auth/governance behavior, database schema, migrations, dependencies, lockfiles, and package scripts were not modified.

The failure chain was broken by making Caddy independent of API/web health, allowing web to start without API health, removing API/web public host ports, resolving the API/Grafana host port conflict, adding a static Caddy storefront fallback, and adding a controlled API JSON fallback.

Verification completed: `docker compose -f docker-compose.production.yml config`, `pnpm run typecheck`, `pnpm test:architecture`, `pnpm test`, `pnpm run build`, and `pnpm test:unit` all passed. Degraded-mode container-stop smoke tests were documented but not executed because production-like container restarts were not approved.

## Pass 2B Validation Checkpoint - 2026-06-03

Protected systems touched: NO.

Pass 2B validation inspected only the approved deployment, Caddy, fallback, production-verification, deployment-runbook, and refactor documentation files. No API code, web code, service worker behavior, env files, package files, lockfiles, dependencies, database schema, migrations, checkout/payment behavior, recommendation systems, admin/auth/governance behavior, server-side GTM behavior, or telemetry fanout behavior was modified.

Confirmed by static validation: Compose config parses; Caddy remains independent of API/web health in Compose topology; Caddy is the only public edge on `80/443`; API and web have no host ports; Grafana is localhost-bound at `127.0.0.1:3001:3000`; Postgres, Redis, PgBouncer, PgHero, Prometheus, node-exporter, and sGTM host bindings are localhost-only; fallback file path and mount agree; fallback file exists and is readable; docs use `shopgoldplus.com`, `www.shopgoldplus.com`, `api.shopgoldplus.com`, and `metrics.shopgoldplus.com`.

Blocked validation: the required `caddy:2-alpine` disposable-container validation could not run because the local Docker daemon was unavailable at `/var/run/docker.sock`. Pass 3 should not be approved on Pass 2B evidence until Caddyfile validation succeeds with the production image.

## Pass 2D Deferred Validation Preparation - 2026-06-03

Protected systems touched: NO.

Pass 2D prepared documentation only. No application code, API code, web code, service worker behavior, checkout/payment behavior, recommendation systems, admin/auth/governance behavior, server-side GTM behavior, telemetry fanout behavior, env files, package files, lockfiles, database schema, migrations, Docker/Caddy config, deployment commands, or production services were changed.

Docker blocker summary: local Docker remains unavailable at `unix:///var/run/docker.sock`; Colima is installed but stopped; `colima start` failed because `qemu-img` is missing. Manual local unblock command: `brew install qemu && colima start && docker info`.

Prepared future validation: `docs/caddy-runtime-validation-runbook.md` now documents a Local Mac path and a Hetzner server path. Both paths use disposable `docker run --rm` validation with `caddy:2-alpine`, the Compose-matching fallback mount `/srv/caddy-fallback`, fallback file checks, and `docker compose -f docker-compose.production.yml config`. The Hetzner path is explicitly non-deploying and forbids `docker compose up/down`.

Pass 2 remains blocked until Caddy runtime validation succeeds. Pass 3 is not approved.

## Pass 3 Governance/Admin Read Protection Checkpoint - 2026-06-03

Protected systems touched: NO.

Pass 3 implementation changed only the governance admin route protection, the shared admin SSR list helper, admin pages using that helper, unit tests for governance admin reads, and approved refactor docs. It did not modify recommendation systems, recommendation scoring, recommendation placements, visitor intelligence, storefront rails, checkout/payment logic, database schema, migrations, packages, lockfiles, env files, Docker/Caddy config, deployment behavior, server-side GTM behavior, or telemetry fanout.

Security changes: `/governance/admin/*` now requires admin authentication; dashboard stats, product, payment, quote, support, and dealer read routes require existing permission constants; existing order read/manage permissions remain in place. `tryFetchAdminList` now forwards the existing admin session token when caller pages provide it.

Validation completed: initial targeted Vitest execution failed with host `ENOSPC` while writing cache/results files, so tests were rerun with low-worker Vitest settings. `pnpm run typecheck`, targeted governance/order admin tests, `pnpm test:architecture`, full Vitest suite, `pnpm run build`, unit-only Vitest suite, and `pnpm lint` all passed. Existing lint warnings remain non-blocking.
