# CODEX REPOSITORY MAP (verified paths only)

All paths relative to the git root; app under `goldplus-commerce/`. Every path below was confirmed with
`git ls-files` / `git grep` at HEAD `3fe0f13`. Guessed paths are not listed; unknowns say `VERIFY`.

## Automation — domain
- `goldplus-commerce/apps/api/src/domain/automation/Automation.ts` — symbols: `canTransitionDefinition`,
  `validateVersionConfig`, `isVersionMutable`, `canActivate`, `isApprovalValid`, `computeNextRun`,
  `resolveMisfire`, `buildTriggerExecutionKey`, `buildActionIdempotencyKey`, `evaluateConditions`,
  `isSupportedAction`, `isCustomerFacingAction`, `isReplayable`. Pure (no infra imports). Protected? Editable in A3.1+. Depends on: nothing. Tests: `tests/unit/AutomationA1Domain.test.ts`, `tests/unit/AutomationA2Planning.test.ts`.

## Automation — application
- `goldplus-commerce/apps/api/src/application/use-cases/automation/PlanAutomationExecutionUseCase.ts` —
  `PlanAutomationExecutionUseCase`. Depends on the three ports below. Never calls providers. Tests: `AutomationA2Planning.test.ts`. Proof: `automation-planning-proof.ts`.

## Automation — ports
- `goldplus-commerce/apps/api/src/application/ports/IAutomationRepository.ts` — `IAutomationRepository`,
  `IAutomationExecutionRepository`, `IAutomationAudienceReader`, `ActiveAutomation`, `AutomationPlanInput`, `AudienceResolution`.

## Automation — infrastructure
- `goldplus-commerce/apps/api/src/infrastructure/db/repositories/DrizzleAutomationRepositories.ts` —
  `DrizzleAutomationRepository`, `DrizzleAutomationExecutionRepository`, `DrizzleAutomationAudienceReader`.
  Gotcha: contains the JSONB normalization workaround (see risk R1). Audience source = `customer_profiles`.
- `goldplus-commerce/apps/api/src/infrastructure/Registry.ts` — `Registry` composition root; automation members `automationRepo`, `automationExecutionRepo`, `automationAudienceReader`, `planAutomationExecutionUseCase`. Protected structurally (do not reorder DI carelessly — see risk R18).

## Automation — schema / migration
- `goldplus-commerce/apps/api/src/infrastructure/db/schema/automation.ts` — `automationDefinitions`,
  `automationVersions`, `automationApprovals`, `automationExecutions`, `automationActionExecutions`,
  `automationSuppressions`, `automationEvents`. Registered in `.../db/schema/index.ts`.
- `goldplus-commerce/apps/api/src/infrastructure/db/migrations/0039_mighty_automation.sql` — PROTECTED (never rewrite).

## Automation — routes / UI
- **None yet** (A4). `git ls-files | grep -iE "routes/admin/automation|pages/admin/automation"` → expect empty.
- Name collision to ignore: `goldplus-commerce/apps/web/src/components/admin/measurement-control-tower/GtmAutomationPanel.astro` is the **measurement GTM** panel, NOT the Automation control plane.

## Outbox (REUSE — do not duplicate)
- `.../application/use-cases/outbox/ProcessOutboxBatchUseCase.ts` (`ProcessOutboxBatchUseCase`); tests `tests/unit/ProcessOutboxBatchUseCase.test.ts`.
- `.../infrastructure/db/repositories/DrizzleOutboxRepository.ts` (`DrizzleOutboxRepository`).
- `.../infrastructure/outbox/OutboxProcessor.ts` (`OutboxProcessor`).
- `.../infrastructure/db/schema/system.ts` (`outboxEvents` → table `outbox_events`).

## Workers / tickers / BullMQ
- `.../infrastructure/scheduler/OutboxTicker.ts` (`OutboxTicker`). BullMQ/Redis: VERIFY (`git grep -ni "bullmq\|ioredis" -- goldplus-commerce/apps/api/src`).

## Notifications / providers (REUSE)
- `.../infrastructure/notifications/NotificationRouter.ts`; adapters `.../notifications/zeptomail/ZeptoMailAdapter.ts`, `.../notifications/whatsapp/WhatsAppAdapter.ts`, `.../notifications/sms/{PahappaCommsSmsAdapter,DisabledSmsAdapter}.ts`.

## Consent / preferences / provider gates
- `.../application/services/consent/ConsentOperationsSummaryService.ts` (gate names). Consent ports/services under `.../application/{ports,services}/consent/*`.

## Customer DNA / NBA (PROTECTED)
- `.../domain/customer-dna/*`; repos `.../infrastructure/db/repositories/DrizzleCustomerDnaRepositories.ts`, `DrizzleCustomerSignalReader.ts`; migration 0037.

## Decision Intelligence (PROTECTED)
- `.../domain/decision-intelligence/DecisionIntelligence.ts`; repos `DrizzleDecisionInsightRepository.ts`, `DrizzleDecisionEvidenceReader.ts`; migration 0038; `decision_recommendations.handoff_state='DRAFT_RECOMMENDATION'` = Automation handoff seed.

## RBAC / audit
- `.../interfaces/http/middleware/permissions.ts` (`requirePermissions`); `goldplus-commerce/packages/shared/src/permissions/index.ts` (`PERMISSIONS`); `.../application/use-cases/audit/CreateAuditLogUseCase.ts`.

## Clock / time
- No dedicated abstraction found (VERIFY). Convention: pass `now: Date` into domain functions.

## Transactions / locking
- Drizzle `db.transaction(...)`, `FOR UPDATE` / `onConflictDoNothing` patterns used across repos (e.g. inventory reservation, automation plan). Reuse; no new locking framework.

## Tests
- Unit: `goldplus-commerce/tests/unit/*` (incl. `AutomationA1Domain.test.ts`, `AutomationA2Planning.test.ts`). Architecture: `goldplus-commerce/tests/architecture/{boundaries,domain-purity}.test.ts`. Admin protection sweep: `git ls-files | grep -i Slice08B1AdminRouteProtectionSweep` (bump counts when adding admin pages in A4).

## Proof scripts
- `.../apps/api/src/scripts/automation-planning-proof.ts` (A2). Earlier module proofs also under `.../scripts/` (`customer-dna-identity-proof.ts`, `decision-intelligence-proof.ts`, `dispatch-consumption-proof.ts`, `delivery-report-proof.ts`, `inventory-concurrency-proof.ts`).

## Completion docs
- `goldplus-commerce/docs/completion/{CURRENT_EXECUTION_STATE.md,GOLDPLUS_ABSOLUTE_COMPLETION_MATRIX.md,goldplus-absolute-completion-matrix.json,COMMERCE_OS_EXECUTION_QUEUE.json}`; `goldplus-commerce/NEXT_WORKTREE_README.md`; this handover under `goldplus-commerce/docs/handover/codex/`.

## Release / deployment
- `git ls-files | grep -iE "docker-compose|Caddyfile|Dockerfile"` (root of `goldplus-commerce/`). Production deploy is EXTERNAL_BLOCKED here.
