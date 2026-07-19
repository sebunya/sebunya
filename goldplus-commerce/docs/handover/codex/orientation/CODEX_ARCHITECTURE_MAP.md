# Codex Architecture Map

Baseline: `bfb0ffc3d004f8eecc039722f540eef75d8d7193` on `phase-2-measurement-control-tower-completion`.
Paths are relative to the outer Git root. This document records source architecture, not production deployment status.

## Repository and package boundaries

- The outer worktree is the Git root. The application is the `goldplus-commerce/` pnpm workspace.
- Runtime packages are `goldplus-commerce/apps/api`, `goldplus-commerce/apps/web`, and `goldplus-commerce/packages/shared`; their boundaries are declared by `goldplus-commerce/pnpm-workspace.yaml` and their package manifests.
- `goldplus-commerce/apps/api/src/domain` contains framework-free domain rules. `application` owns use cases and ports. `infrastructure` owns Drizzle, PostgreSQL, providers, queues, schedulers, logging, metrics, and composition. `interfaces/http` owns Hono transport concerns.
- `goldplus-commerce/apps/web` is an Astro server application. It consumes the API through `goldplus-commerce/apps/web/src/lib/api.ts` and reads the server-side admin session through `goldplus-commerce/apps/web/src/lib/session.ts`.
- `goldplus-commerce/packages/shared` owns cross-runtime API envelopes, permissions, events, and shared types. It must not become a back door from domain code into adapters.

## Runtime entry points and build graph

| Concern | Entry or configuration | Runtime relationship |
|---|---|---|
| API | `goldplus-commerce/apps/api/src/interfaces/http/server.ts` | Loads environment and OpenTelemetry, starts the Hono app, the existing outbox ticker, and registered BullMQ workers; graceful shutdown closes HTTP, ticker, DB, and queues. |
| API composition | `goldplus-commerce/apps/api/src/interfaces/http/app.ts` | Applies correlation IDs, Pino request logging, rate limits, maintenance/shadow middleware, route mounts, common error and not-found envelopes. |
| Dependency composition | `goldplus-commerce/apps/api/src/infrastructure/Registry.ts` | Singleton composition root that constructs ports, adapters, services, and use cases. Extend carefully; existing initialization order is protected. |
| Web | `goldplus-commerce/apps/web/astro.config.mjs` and `goldplus-commerce/apps/web/src/pages` | Astro standalone server with file-system routes and server-rendered admin pages. |
| Shared | `goldplus-commerce/packages/shared/src/index.ts` | Workspace types and constants imported by API and web. |
| Database | `goldplus-commerce/apps/api/src/infrastructure/db/client.ts` | postgres-js client wrapped by Drizzle; statement timeout, connection bounds, transaction retry, and metrics live here. |
| Schema | `goldplus-commerce/apps/api/src/infrastructure/db/schema/index.ts` | Barrel exports the bounded schema files consumed by Drizzle. |
| Migrations | `goldplus-commerce/apps/api/src/infrastructure/db/migrations/migrate.ts` | Drizzle migrator with one exact historical compatibility shim; `rehearse.ts` supplies the isolated rehearsal entry point. |
| Production graph | `goldplus-commerce/docker-compose.production.yml`, `goldplus-commerce/Caddyfile` | PostgreSQL, Redis, PgBouncer, API, web, Caddy, metrics, and observability composition. C0 does not claim this graph is deployed at the source head. |

The root package scripts compile the shared package and API, build Astro, run Vitest and Playwright, and invoke Drizzle migration tooling. The API image compiles the shared package before API TypeScript and then rewrites the image-local shared package entry to compiled output; see `goldplus-commerce/apps/api/package.json` and `goldplus-commerce/Dockerfile.api`. The web image builds the Astro standalone bundle from `goldplus-commerce/Dockerfile.web`.

## API and UI composition

`goldplus-commerce/apps/api/src/interfaces/http/app.ts` is the sole Hono application aggregator. Public commerce, account, consent, telemetry, product, health, and webhook routes are mounted separately from admin routes. Admin modules use `authMiddleware` plus an explicit `requirePermissions(...)` call per handler. Route handlers resolve use cases through `Registry`; repository imports from routes are forbidden by `goldplus-commerce/tests/architecture/boundaries.test.ts` and `goldplus-commerce/tests/architecture/domain-purity.test.ts`.

The Astro administrator shell is `goldplus-commerce/apps/web/src/layouts/AdminLayout.astro`; navigation metadata is centralized in `goldplus-commerce/apps/web/src/lib/admin-navigation.ts`. Mature admin surfaces follow server-rendered fetch/form handling and explicitly render denied, unavailable, no-data, success, and conflict states. Representative surfaces are `goldplus-commerce/apps/web/src/pages/admin/decision-intelligence/index.astro`, `goldplus-commerce/apps/web/src/pages/admin/fulfilment/index.astro`, and `goldplus-commerce/apps/web/src/pages/admin/fulfilment/[id]/packing.astro`. Reusable explanatory empty states live in `goldplus-commerce/apps/web/src/components/admin/AdminEmptyState.astro`.

## Domain and adapter boundaries

Domain modules model states, transitions, invariants, calculations, and deterministic keys. Examples include `goldplus-commerce/apps/api/src/domain/automation/Automation.ts`, `goldplus-commerce/apps/api/src/domain/fulfilment/FulfilmentTask.ts`, and `goldplus-commerce/apps/api/src/domain/decision-intelligence/DecisionIntelligence.ts`. Callers inject `Date` values into deterministic rules; no repository-wide `Clock`/`IClock` abstraction exists at this baseline.

Application ports describe persistence and external capabilities. Representative contracts are `goldplus-commerce/apps/api/src/application/ports/IAutomationRepository.ts`, `goldplus-commerce/apps/api/src/application/ports/IInventoryRepository.ts`, and `goldplus-commerce/apps/api/src/application/ports/IOutboxRepository.ts`. Infrastructure adapters implement those contracts in `goldplus-commerce/apps/api/src/infrastructure/db/repositories` and provider-specific directories.

## Persistence and transaction boundaries

Schema is divided by bounded concern rather than one monolithic file: commerce, identity, inventory, fulfilment, customer DNA, Decision Intelligence, Automation, consent, preferences, measurement, telemetry, loyalty, and system/outbox each have schema files under `goldplus-commerce/apps/api/src/infrastructure/db/schema`.

The established concurrency tools are:

- PostgreSQL transactions and deterministic row locks for inventory in `goldplus-commerce/apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository.ts`.
- Optimistic `version` predicates for fulfilment line, dispatch, and Decision Intelligence workflow updates in `DrizzleFulfilmentLineRepository.ts`, `DrizzleFulfilmentDispatchRepository.ts`, and `DrizzleDecisionInsightRepository.ts`.
- Unique keys plus `onConflictDoNothing` for fulfilment-per-order, outbox events, customer projections, decisions, and Automation plans/actions.
- `FOR UPDATE SKIP LOCKED` for shared outbox consumption in `goldplus-commerce/apps/api/src/infrastructure/db/repositories/DrizzleOutboxRepository.ts`.

Migrations `0000` through `0039` are immutable history. The next number is `0040` only if a real schema requirement is proven. Migration integrity and fresh/populated rehearsal behavior are protected by `goldplus-commerce/tests/unit/Slice14CMigrationIntegrity.test.ts`, `goldplus-commerce/apps/api/src/infrastructure/db/migrations/migrate.ts`, and `goldplus-commerce/apps/api/src/infrastructure/db/migrations/rehearse.ts`.

## Workers, tickers, outbox, and provider routing

There is one existing notification outbox. Its port is `goldplus-commerce/apps/api/src/application/ports/IOutboxRepository.ts`, processor is `goldplus-commerce/apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase.ts`, adapter is `goldplus-commerce/apps/api/src/infrastructure/db/repositories/DrizzleOutboxRepository.ts`, table is `outbox_events` in `goldplus-commerce/apps/api/src/infrastructure/db/schema/system.ts`, and ticker is `goldplus-commerce/apps/api/src/infrastructure/scheduler/OutboxTicker.ts`.

There is also an existing BullMQ/Redis framework in `goldplus-commerce/apps/api/src/infrastructure/queues/QueueService.ts` and `QueueWorkers.ts`. Automation must integrate with these existing mechanisms; another scheduler, worker framework, outbox, or notification router is not an extension point.

Provider selection is centralized by `goldplus-commerce/apps/api/src/infrastructure/notifications/NotificationRouter.ts`, with email, WhatsApp, and SMS adapters under `infrastructure/notifications`. Missing configuration yields no target or explicit disabled/not-configured outcomes. Customer-facing sends remain gated by environment checks in provider/consent activation code; C0 performs no provider activity.

## Consent, RBAC, audit, logging, metrics, and redaction

Consent is a protected boundary spanning `goldplus-commerce/apps/api/src/domain/consent`, application consent ports/services, consent repositories, and consent routes. `ConsentFoundation.ts` encodes restrictive invariants: anonymous or checkout-only identities cannot grant optional marketing, withdrawal supersedes grant, and policy blocks take precedence.

RBAC has three linked layers: constants in `goldplus-commerce/packages/shared/src/permissions/index.ts`, authentication in `goldplus-commerce/apps/api/src/interfaces/http/middleware/auth.ts`, and fail-closed permission checks in `permissions.ts`. Auditable mutations use `CreateAuditLogUseCase` or an explicitly documented dedicated audit channel, enforced by the architecture test.

Structured logging uses Pino with trace/job/user/worker context in `goldplus-commerce/apps/api/src/infrastructure/logging/logger.ts` and correlation propagation from `interfaces/http/app.ts`. Prometheus metrics are registered defensively in `interfaces/http/routes/metrics.ts`, `infrastructure/db/client.ts`, and `infrastructure/queues/QueueService.ts`. Payload-specific redaction is explicit, not magical: examples are `PreferenceRedactor.ts`, `ProductFinderRedactor.ts`, and `application/services/measurement/PaidSocialPayloadRedactor.ts`. New Automation evidence/logging must use a redaction boundary and must not log raw subject/contact values.

## Architecture status at the baseline

- Fulfilment F1-F5, inventory, Customer DNA/NBA, and Decision Intelligence are source-complete with local tests/proof scripts recorded in repository evidence; none is promoted to `LIVE_VERIFIED` by C0.
- Automation A1 domain/schema and A2 planning/repositories/proof exist. There is no Automation admin API or UI at this baseline. Eligibility/suppression ordering, frequency caps, action execution/outbox linkage, retry/DLQ/replay, control-room API/UI, and final acceptance remain queued.
- The immediate safe extension seam is the existing Automation domain/ports/use-case/repository set, then Registry composition, existing outbox/NotificationRouter, and later new permission constants/routes/pages. Protected business modules are dependencies, not rewrite targets.
