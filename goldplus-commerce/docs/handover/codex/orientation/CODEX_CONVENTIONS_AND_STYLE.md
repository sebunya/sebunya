# Codex Conventions and Style

These are observed GoldPlus conventions at `bfb0ffc3d004f8eecc039722f540eef75d8d7193`. They are descriptive, including uneven legacy areas; they are not a generic TypeScript style guide.

## TypeScript style

- The codebase uses TypeScript interfaces and discriminated unions to make outcomes explicit, with classes for orchestrating use cases and repositories. Examples: `RecordPaymentWebhookResult` in `goldplus-commerce/apps/api/src/application/use-cases/payments/RecordPaymentWebhookUseCase.ts`, `EvaluationOutcome` in `goldplus-commerce/apps/api/src/domain/decision-intelligence/DecisionIntelligence.ts`, and `PlanBatchResult` in `goldplus-commerce/apps/api/src/application/use-cases/automation/PlanAutomationExecutionUseCase.ts`.
- Constructor injection with `private readonly` is dominant in application and infrastructure classes. Examples: `CheckoutUseCase`, `PlanAutomationExecutionUseCase`, and `ProcessOutboxBatchUseCase`.
- Constants name operational bounds and policies near their use (`MAX_LINE_ITEMS`, `MAX_ACTIONS_PER_EXECUTION`, `BATCH_SIZE`/`MAX_ATTEMPTS`) rather than embedding unexplained numbers throughout branches.
- Formatting is pragmatic rather than uniform: both single and double quotes and both expanded and compact object literals exist. Match the nearest mature module; do not reformat unrelated files. The API compiles to CommonJS while Astro uses ESNext/Bundler settings; preserve each package's `tsconfig.json` contract.

## Domain entities and invariants

- Domain code is pure with no Hono, Drizzle, route, or provider-adapter imports. This is enforced by `goldplus-commerce/tests/architecture/boundaries.test.ts` and `domain-purity.test.ts`, and exemplified by `domain/automation/Automation.ts`, `domain/fulfilment/FulfilmentTask.ts`, and `domain/decision-intelligence/DecisionIntelligence.ts`.
- State changes are represented as explicit allowed-transition maps/functions and terminal-state checks. Examples: `canTransitionDefinition`, `canTransitionFulfilment`, and `canTransitionInsight`.
- Rehydration/factory methods protect entity construction and invariants. Representative symbols are `Order.create` in `domain/commerce/Order.ts`, `FulfilmentTask.openForOrder`/`rehydrate` in `domain/fulfilment/FulfilmentTask.ts`, and `FulfilmentLine.rehydrate` in `domain/fulfilment/FulfilmentLine.ts`.
- Determinism is explicit: callers pass `now`, versioned policies produce evidence, and stable business keys encode scope. Examples: `evaluatePolicy(..., now)`, `resolveMisfire(..., now)`, `buildInsightIdempotencyKey`, `buildTriggerExecutionKey`, and `buildActionIdempotencyKey`.

## Use-case style

- A use case is usually a small class with injected ports and one public `execute` method. It validates orchestration input, delegates domain rules, persists through ports, and returns a typed result. Examples: `CheckoutUseCase`, `CreateFulfilmentTaskOnOrderPlacedUseCase`, and `PlanAutomationExecutionUseCase`.
- Expected business rejection is commonly returned as `{ ok: false, code, message }`; impossible or malformed lower-level conditions may throw. Examples: `RecordPaymentWebhookUseCase`, `TransitionDecisionInsightUseCase` in `DecisionIntelligenceUseCases.ts`, and `CreateAuditLogUseCase`.
- Batch work is bounded and reports counters rather than hiding partial outcomes. Examples: `PlanBatchResult`, `ProcessOutboxBatchResult`, and `EvaluateDecisionSignalsBatchUseCase`.
- Side-effect boundaries are named truthfully: planning does not send, enqueueing writes an intent, and provider success alone earns `SENT`. `PlanAutomationExecutionUseCase`, `EnqueueAdminOrderEmailUseCase`, and `ProcessOutboxBatchUseCase` are the representative chain.

## Ports and repositories

- Application ports live under `apps/api/src/application/ports` and import domain types, not infrastructure. Examples: `IAutomationRepository.ts`, `IInventoryRepository.ts`, and `IOutboxRepository.ts`.
- Drizzle implementations live under `infrastructure/db/repositories`, implement the port, map persisted rows to domain/application shapes, and hide SQL details. Examples: `DrizzleAutomationRepositories.ts`, `DrizzleInventoryRepository.ts`, and `DrizzleDecisionInsightRepository.ts`.
- Repository methods encode idempotency/concurrency in names and contracts (`persistPlan`, `updateWithVersion`, `claimDueBatch`, `enqueueAdminOrderEmail`) rather than expecting route handlers to coordinate races.
- The observed A2 Automation repository currently contains compatibility reads for both JSONB strings and objects. That is a localized workaround, not a convention to copy into every caller.

## Transactions and concurrency

- Use `db.transaction(...)` when multiple rows/counters form one invariant. `DrizzleInventoryRepository.ts`, `DrizzleOrderRepository.ts`, and `DrizzlePaymentRepository.ts` are representative.
- Lock rows in deterministic order for pessimistic coordination. Inventory sorts product IDs then uses `.for('update')`; outbox claiming uses `.for('update', { skipLocked: true })` in `DrizzleOutboxRepository.ts`.
- Use optimistic versions when an operator edits a previously read aggregate. `DrizzleFulfilmentLineRepository.ts`, `DrizzleFulfilmentDispatchRepository.ts`, and `DrizzleDecisionInsightRepository.ts` update with `WHERE version = expectedVersion` and surface stale conflicts.
- Use unique constraints plus `onConflictDoNothing` for restart-safe idempotency. Examples include order fulfilment creation, outbox email intents, Decision Intelligence keys, and Automation trigger/action keys.

## Drizzle schema style

- Schema is split by bounded concern and re-exported by `infrastructure/db/schema/index.ts`. `schema/commerce.ts`, `schema/customer_dna.ts`, and `schema/automation.ts` show the pattern.
- PostgreSQL-native types are explicit: UUID primary keys with `defaultRandom`, `timestamp(..., { withTimezone: true })`, integer counters, booleans, varchar lengths, and `jsonb` for evidence/configuration.
- Indexes and uniqueness are named and declared beside the table. Representative constraints are `automation_versions_def_version_idx`, the customer DNA identity uniqueness in `schema/customer_dna.ts`, and Decision Intelligence idempotency/version indexes in `schema/decision_intelligence.ts`.
- Relations that enforce lifecycle ownership use FKs; application-visible enums are generally varchar values protected by domain functions/tests rather than PostgreSQL enums.

## Migration style

- Generated/additive SQL migrations are immutable after commitment. `0037_wise_customer_dna.sql`, `0038_brave_decision_intelligence.sql`, and `0039_mighty_automation.sql` mirror their schema additions and add named indexes/FKs.
- Statements are separated by Drizzle's `--> statement-breakpoint`; repeated-safe DDL uses `IF NOT EXISTS`, and FK blocks tolerate `duplicate_object` where generated history requires it.
- Historical migration defects are repaired additively, not rewritten. The exact exception shim in `migrations/migrate.ts`, its allowlist in `knownInvalidHistoricalStatements.ts`, and `Slice14CMigrationIntegrity.test.ts` document that precedent.
- A schema change needs both fresh replay and populated upgrade rehearsal through `migrations/rehearse.ts`; A3 must use `0040` only if real evidence proves a schema change.

## Hono routes and Zod validation

- Route modules create a local `Hono`, define Zod request/query schemas near handlers, use `safeParse`, and return `ApiResponse<T>` envelopes. Examples: `routes/commerce.ts`, `routes/admin/fulfilment.ts`, and `routes/admin/decision-intelligence.ts`.
- Admin modules call `routes.use('*', authMiddleware)` and attach `requirePermissions([PERMISSIONS.X])` to every handler. Architecture tests enforce both.
- Routes obtain use cases from `Registry`; direct schema/repository imports are forbidden. Successful responses are `{ success: true, data }`; errors use stable codes/messages and appropriate 400/401/403/404/409/503 statuses.
- Static paths are registered before parameter paths when shadowing is possible, as documented in `routes/admin/fulfilment.ts` for `/report` before `/:id`.

## Error mapping and conflicts

- Validation maps to stable `INVALID_BODY`, `INVALID_QUERY`, or module-specific codes. Authentication maps to `UNAUTHENTICATED`; authorization to `FORBIDDEN`; missing records to 404; optimistic staleness/invalid workflow conflicts to 409.
- Representative mappings are `errStatus` in `routes/admin/decision-intelligence.ts`, `packingErrStatus` in `routes/admin/fulfilment.ts`, and global `DB_NOT_CONFIGURED`/`INTERNAL_SERVER_ERROR` handling in `interfaces/http/app.ts`.
- Operator UI does not flatten conflicts into generic errors. `pages/admin/fulfilment/[id]/packing.astro`, `pages/admin/fulfilment/[id]/dispatch.astro`, and `pages/admin/decision-intelligence/[id].astro` render a distinct amber conflict message and reload current state.

## RBAC and audit

- Permission strings are centralized in `goldplus-commerce/packages/shared/src/permissions/index.ts`; API routes reference constants, never ad hoc role names.
- `goldplus-commerce/apps/api/src/interfaces/http/middleware/auth.ts` verifies the bearer token, active user, and effective permission list. `permissions.ts` requires every requested permission and fails closed.
- Writes call `CreateAuditLogUseCase` or have an `audit-exempt:` comment naming a dedicated use-case audit channel. This is enforced by `tests/architecture/boundaries.test.ts`; representative audited workflows are Decision Intelligence use cases, fulfilment mutation use cases, and admin role/user routes.
- Audit records have actor, action, entity, entity ID, before/after state and reject blank/oversized keys in `CreateAuditLogUseCase.ts` and `domain/audit/AuditLogEntity.ts`.

## Astro administrator UI and operational states

- Admin pages use `AdminLayout.astro`, read `goldplus_session` with `lib/session.ts`, redirect missing sessions to `/admin/login?returnTo=...`, and send bearer auth to the API.
- Server-side GETs commonly use `Promise.all`, degrade unavailable secondary panels independently, and show truthful state rather than inventing data. Examples: Decision Intelligence, fulfilment queue, and Customer DNA admin pages.
- Loading, empty, error, access-denied, and protected states are explicit in `components/admin/AdminEmptyState.astro`; `pages/admin/measurement/consent.astro` has client-side loading/empty/error states; `pages/admin/decision-intelligence/index.astro` distinguishes no data, no filter matches, permission denial, and API failure.
- Forms use native POST handling, descriptive operator notices, bounded input, and confirmation for high-impact actions. Styling uses Tailwind utility classes, high-contrast chips, status text in addition to color, `en-UG` formatting, and responsive grids/tables.

## Test layout and proof style

- Vitest tests live mainly in `goldplus-commerce/tests/unit`, architecture tests in `tests/architecture`, E2E Playwright tests in `tests/e2e`, and UAT tests in `tests/uat`. `vitest.config.ts` excludes E2E; `playwright.config.ts` defines desktop and mobile projects.
- Unit tests group domain rule and use-case outcomes with `describe`/`it`, fixed dates, small fakes, and explicit negative/idempotency cases. Examples: `AutomationA1Domain.test.ts`, `AutomationA2Planning.test.ts`, and `DecisionIntelligence.test.ts`.
- Real PostgreSQL proofs are executable TypeScript scripts under `apps/api/src/scripts`; they refuse `NODE_ENV=production`, create uniquely keyed fixtures, test the real Drizzle/PostgreSQL behavior, print a JSON verdict, and clean up. Examples: `automation-planning-proof.ts`, `inventory-concurrency-proof.ts`, and `packing-concurrency-proof.ts`.
- Concurrency proofs use `Promise.all` against independent calls and assert database row counts/versions/constraints after the race. Unit fakes alone are not accepted for a persistence race claim.
- Some historical safety tests inspect `git status` and therefore deliberately fail on unrelated dirty paths. Representative examples are `goldplus-commerce/tests/unit/Slice08B1AdminRouteProtectionSweep.test.ts`, `Slice09B1RConsentBoundaryApprovalGate.test.ts`, and `Slice09XPrimeConsentOperatingLayerP0.test.ts`. Run focused tests from the exact allowed slice boundary, or after its commit, and never weaken their allowlists merely to make a mixed worktree pass.

## Logging, metrics, and PII redaction

- Pino is the structured logger; `logger.ts` injects trace/span/job/user/worker context from `TraceContext.ts`. HTTP correlation IDs are created and returned by `interfaces/http/app.ts`; queue jobs propagate trace context in `QueueService.ts`.
- Metrics use `prom-client` Gauge/Counter/Histogram instances with `goldplus_` names and defensive registration to tolerate test/module reloads. Examples: DB metrics in `db/client.ts`, queue wait/duration in `QueueService.ts`, and scrape health/degradation in `routes/metrics.ts`.
- Redaction is payload-specific and recursive. `PreferenceRedactor.ts`, `ProductFinderRedactor.ts`, and `PaidSocialPayloadRedactor.ts` remove contact/secret fields while retaining safe hashes or operational evidence.
- The codebase still contains legacy `console.error` calls and the DB slow-query wrapper logs query parameters. Therefore new code must not assume global redaction: it must avoid raw PII in evidence, logger fields, idempotency keys, provider payload snapshots, and errors. Automation should store references/hashes and bounded reason codes, then redact at any read/log boundary.

## HOW NEW GOLDPLUS CODE SHOULD LOOK

New GoldPlus code should look like the mature fulfilment, Decision Intelligence, Customer DNA, and Automation A1/A2 slices: a pure deterministic domain rule with explicit states and evidence; a small constructor-injected use case returning typed outcomes; an application port; one Drizzle adapter that owns SQL, mapping, transaction, lock, version, and idempotency behavior; Registry wiring; a thin Hono route with Zod, `ApiResponse`, auth, permission and audit; an Astro surface with truthful denied/loading/empty/error/conflict states; focused fixed-time unit tests; and a non-production real-PostgreSQL proof for persistence or concurrency claims. It should reuse the existing outbox, router, queue, consent, RBAC, audit, logging, metrics, and redaction boundaries. Changes should remain bounded, avoid unrelated formatting, carry stable reason/error codes, preserve immutable migrations, and never equate queued/planned/dry-run state with a completed external effect.
