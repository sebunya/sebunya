# CODEX MASTER HANDOVER — GoldPlus Automation A3

Authoritative, repository-grounded handover. Every material claim cites a path + symbol + how it was
verified. Where not independently rerun during this handover, it is labelled `REPORTED — NOT RERUN`.
Line numbers are omitted deliberately (they drift); use paths + symbols.

## 9.1 Repository identity (verified)
- Root: `/home/user/sebunya/goldplus-clean-continuation/phase-2-measurement-control-tower-completion-20260715`; app subdir `goldplus-commerce/`.
- Branch `phase-2-measurement-control-tower-completion`; HEAD `3fe0f13218355bfe273348a75b6b77c845015637` == origin; clean.
  - Verified by: `git rev-parse HEAD`, `git rev-parse origin/...`, `git status --porcelain`.
- Remote: `http://local_proxy@127.0.0.1:41729/git/sebunya/sebunya` (`git remote -v`).
- Node `v22.22.2`, pnpm `10.33.0` (`node --version`, `pnpm --version`).
- Production: alias `goldplus-prod`, path `/opt/goldplus/app/goldplus-commerce`, URL `https://shopgoldplus.com`. Status **EXTERNAL_BLOCKED** in this environment (no ssh binary, no docker daemon).

## 9.2 Architecture contract (verified)
Clean/hexagonal: pure domain → application use cases → ports → Drizzle repositories/adapters → thin Hono
routes; Astro admin UI; PostgreSQL 16 via Drizzle; transactional outbox; RBAC; audit.
- Composition root: `goldplus-commerce/apps/api/src/infrastructure/Registry.ts` (symbol `Registry`). Evidence: `git grep -n "class Registry" -- goldplus-commerce/apps/api/src`.
- Architecture boundary tests: `goldplus-commerce/tests/architecture/boundaries.test.ts` (its: "domain files must not import framework/database/adapter", "HTTP routes must not import repositories directly", "Application layer must not import Infrastructure layer", "admin route files must import auth + requirePermissions", "admin and governance write routes must call CreateAuditLogUseCase") and `goldplus-commerce/tests/architecture/domain-purity.test.ts`. Evidence: `git grep -n "it(" -- goldplus-commerce/tests/architecture/boundaries.test.ts`. "architecture 10/10" is **REPORTED — NOT RERUN**; rerun `npx vitest run tests/architecture`.
- RBAC middleware: `goldplus-commerce/apps/api/src/interfaces/http/middleware/permissions.ts` (`requirePermissions`) — fails closed (returns 403 unless `user.permissions.includes(perm)`).
- Audit: `goldplus-commerce/apps/api/src/application/use-cases/audit/CreateAuditLogUseCase.ts`.
- Outbox: table `outbox_events` in `goldplus-commerce/apps/api/src/infrastructure/db/schema/system.ts` (`outboxEvents`); processor `goldplus-commerce/apps/api/src/infrastructure/outbox/OutboxProcessor.ts`; batch use case `.../application/use-cases/outbox/ProcessOutboxBatchUseCase.ts`; ticker `.../infrastructure/scheduler/OutboxTicker.ts`; repo `.../infrastructure/db/repositories/DrizzleOutboxRepository.ts`.
- Notification routing: `goldplus-commerce/apps/api/src/infrastructure/notifications/NotificationRouter.ts`; provider adapters under `.../infrastructure/notifications/{zeptomail,whatsapp,sms}/` (incl. `DisabledSmsAdapter.ts`).
- Redis/BullMQ: **UNKNOWN — NOT VERIFIED** in this handover. Resolve: `git grep -ni "bullmq\|ioredis" -- goldplus-commerce/apps/api/src`.

## 9.3 Verified recent commit timeline
`git log --oneline` at HEAD. Business outcomes below are from commit subjects + inspected source.
| hash | subject | migration | source status |
|---|---|---|---|
| 5d21f95 | Fulfilment F4/F5 UI: dispatch/delivery/report admin surfaces | — | SOURCE_COMPLETE_NOT_DEPLOYED |
| (earlier) | Fulfilment F1–F5, Inventory reservation, admin order email | 0029–0036 | SOURCE_COMPLETE_NOT_DEPLOYED |
| f105521 / 7388307 / bbdfa24 | Customer DNA & NBA (domain/repos/API+RBAC+UI) | 0037 | SOURCE_COMPLETE_NOT_DEPLOYED |
| 480a2ba | Decision Intelligence: explainable operational insights | 0038 | SOURCE_COMPLETE_NOT_DEPLOYED |
| a3a3146 | Automation A1: governed versioned automation domain | 0039 | SOURCE_PARTIAL (A1) |
| 2000fce | Automation A2: restart-safe trigger planning | — | SOURCE_PARTIAL (A1+A2) |
| 3fe0f13 | docs: record Automation A1/A2 progress and A3 resume plan | — | (docs) |
| this commit | Docs: add forensic Codex handover for Automation A3 | — | (docs) |

Production status for every row: **not LIVE_VERIFIED** (EXTERNAL_BLOCKED).

## 9.4 Migration ledger (verified filenames; purposes from commit history + schema)
Verified by `git ls-files | grep -E 'migrations/00(29|3[0-9])_'`.
`0029_bumpy_miss_america` (fulfilment_tasks) · `0030_sharp_omega_sentinel` (priority/SLA/assignment) ·
`0031_slippery_grim_reaper` (inventory) · `0032_boring_may_parker` (teams) · `0033_sudden_lester`
(sla_policy_version, is_lead, fulfilment_sla_events) · `0034_icy_doctor_octopus` (fulfilment_lines,
packing_sessions) · `0035_lonely_iron_fist` (fulfilment_dispatches) · `0036_curly_delivery`
(fulfilment_deliveries) · `0037_wise_customer_dna` (customer_profiles + identity/feature/lifecycle +
nba_decisions/candidates) · `0038_brave_decision_intelligence` (decision_policies/insights/evidence/
recommendations/assignments/events) · `0039_mighty_automation` (automation_definitions/versions/
approvals/executions/action_executions/suppressions/events).
**Next migration number if genuinely required: `0040`. Never rewrite 0000–0039.** Fresh-replay + populated-upgrade through 0039 are **REPORTED — NOT RERUN**; rerun per `CODEX_COMMANDS_AND_PROOFS.md`.

## 9.5 Completed module status matrix (truthful)
| module | commit | migration | domain | repo | API | UI | RBAC | audit | idempotency | real-PG proof | local | prod | residual |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fulfilment F1–F5 + UI | …/5d21f95 | 0029–0036 | Y | Y | Y | Y | Y | Y | Y | Y (multiple) | LOCAL_ACCEPTED | not deployed | — |
| Inventory/oversell | (0031) | 0031 | Y | Y | Y | n/a | Y | Y | Y | Y | LOCAL_ACCEPTED | not deployed | — |
| Customer DNA & NBA | f105521/7388307/bbdfa24 | 0037 | Y | Y | Y | Y | Y | Y | Y | Y (customer-dna-identity-proof.ts) | LOCAL_ACCEPTED | not deployed | consent projection stored UNKNOWN |
| Decision Intelligence | 480a2ba | 0038 | Y | Y | Y | Y | Y | Y | Y | Y (decision-intelligence-proof.ts) | LOCAL_ACCEPTED | not deployed | — |
| **Automation** | a3a3146 + 2000fce | 0039 | A1+A2 | A2 | **NO (A4)** | **NO (A4)** | **NO (A4)** | partial | A1/A2 keys | A2 only (automation-planning-proof.ts) | **SOURCE_PARTIAL** | not deployed | A3–A5 not started |
Nothing is `LIVE_VERIFIED`.

## 9.6 Automation A1 — exact implementation (verified)
- Domain: `goldplus-commerce/apps/api/src/domain/automation/Automation.ts`. Symbols (verified `git grep`): `canTransitionDefinition`, `isReplayable`, `isApprovalValid`, `validateVersionConfig`, `isVersionMutable`, `canActivate`, `computeNextRun`, `resolveMisfire`, `buildTriggerExecutionKey`, `buildActionIdempotencyKey`, `isSupportedAction`, `isCustomerFacingAction`; types `DefinitionStatus`, `ExecutionStatus`, `ApprovalStatus`, `TriggerFamily`, `ActionFamily`, `MisfirePolicy`, `AudiencePolicyMode`, `AutomationVersionConfig`.
- Schema: `goldplus-commerce/apps/api/src/infrastructure/db/schema/automation.ts` — `automationDefinitions`, `automationVersions`, `automationApprovals`, `automationExecutions`, `automationActionExecutions`, `automationSuppressions`, `automationEvents`.
- Migration: `0039_mighty_automation.sql` — unique `(definition_id, version_number)`, unique `trigger_execution_key`, unique action `idempotency_key`, FKs, status/next-run/subject-window/retry-DLQ indexes, lease columns on executions.
- Tests: `goldplus-commerce/tests/unit/AutomationA1Domain.test.ts` (10 tests — lifecycle transitions, replayability, action support/approval, schedule/misfire, idempotency keys).
- Registry wiring for A1: domain is pure (no Registry entry needed); tables via schema barrel `.../db/schema/index.ts`.
- **A1 does NOT provide**: any planning, execution, suppression, outbox, provider, API, UI, RBAC, or repositories. It is domain + tables only.

## 9.7 Automation A2 — exact implementation (verified)
- Ports: `goldplus-commerce/apps/api/src/application/ports/IAutomationRepository.ts` — `IAutomationRepository` (`findActiveApprovedByTrigger`, `isDefinitionPaused`), `IAutomationExecutionRepository` (`persistPlan`, `findByTriggerKey`, `countActionsForExecution`), `IAutomationAudienceReader` (`resolveSubject`).
- Use case: `.../application/use-cases/automation/PlanAutomationExecutionUseCase.ts` (`PlanAutomationExecutionUseCase`). Loads active APPROVED immutable version by trigger, resolves audience, evaluates conditions to evidence, persists ONE idempotent plan + planned actions; returns `{matchedAutomations, planned, ineligible, noData, conflict, duplicate, limitExceeded}`; bounded by `MAX_ACTIONS_PER_EXECUTION`. **Never calls providers.**
- Repositories: `.../infrastructure/db/repositories/DrizzleAutomationRepositories.ts` — `DrizzleAutomationRepository`, `DrizzleAutomationExecutionRepository`, `DrizzleAutomationAudienceReader` (audience source = `customer_profiles`, i.e. Customer DNA).
- Condition evaluation: `evaluateConditions` in `Automation.ts` (lifecycle + consent categories → per-condition evidence).
- Registry wiring: `Registry.ts` public members `automationRepo`, `automationExecutionRepo`, `automationAudienceReader`, `planAutomationExecutionUseCase` (`git grep -n "planAutomationExecutionUseCase" -- goldplus-commerce/apps/api/src`).
- Tests: `goldplus-commerce/tests/unit/AutomationA2Planning.test.ts` (7 tests).
- Real-PG proof: `goldplus-commerce/apps/api/src/scripts/automation-planning-proof.ts` — recorded PASS `{"executionRows":1,"plannedActionRows":1,"evidencePresent":true,"plannedTotal":1,"duplicateTotal":1,"repeatDuplicate":1,"ineligibleCount":1,"noProfileNoData":1,"verdict":"PASS"}`. **REPORTED — NOT RERUN during handover**; rerun command in `CODEX_COMMANDS_AND_PROOFS.md`.
- **A2 does NOT provide**: eligibility/suppression gate order, frequency caps, execution, outbox intents, provider outcomes, retry/DLQ/replay, API, UI, RBAC. Those are A3/A4.

## 9.8 JSONB data-contract issue — KNOWN DEFECT / WORKAROUND / NOT YET NORMALIZED
- Observed: this stack stores jsonb columns **double-encoded as a JSON string** (`jsonb_typeof = 'string'`), so PostgreSQL `->>` key access returns null. Verified during A2 build by `SELECT jsonb_typeof(config) FROM automation_versions` (='string') and by `SELECT jsonb_typeof(items) FROM fulfilment_tasks` (='string') — i.e. **not** Automation-specific; it is platform-wide.
- Affected: any jsonb object column queried by key at the SQL layer.
- A2 workaround (evidence: `DrizzleAutomationRepositories.ts`, `findActiveApprovedByTrigger`): the trigger-match SQL normalizes via `CASE WHEN jsonb_typeof(config)='string' THEN (config #>> '{}')::jsonb ELSE config END ->> 'triggerFamily'`, and the read path does `typeof config === 'string' ? JSON.parse(config) : config`.
- **New Automation writes remain double-encoded** (A2 did not change the write path). Other modules (fulfilment, decision) also double-encode but mostly do not query jsonb internals in SQL, so they function.
- Risks: jsonb key queries/indexes are unreliable; future SQL filters on jsonb will silently miss; condition-evaluation that queried jsonb would be wrong.
- **Recommended first Codex decision (A3.0):** create ONE infrastructure JSONB compatibility boundary (a codec) so new Automation writes are native jsonb objects while legacy reads stay compatible — do NOT scatter parsing, do NOT rewrite the whole platform inside A3.

## 9.9 Existing assets A3 MUST reuse (do not duplicate)
See `CODEX_EVIDENCE_MANIFEST.json` for SHA-256 anchors.
- Outbox: `ProcessOutboxBatchUseCase.ts`, `DrizzleOutboxRepository.ts`, `schema/system.ts` (`outbox_events`), `OutboxProcessor.ts` — external actions persist ONE outbox intent (link via `automation_action_executions.outbox_event_id`, already in 0039). A3 must NOT create a second outbox.
- Scheduler/worker: `OutboxTicker.ts` — reuse; no new scheduler.
- Notifications/providers: `NotificationRouter.ts` + adapters under `infrastructure/notifications/*` — never call providers synchronously from a route/use case; only the processor calls them.
- Consent/preferences + audience: Customer DNA under `domain/customer-dna/*` and `DrizzleCustomerProfileRepository` (A2 audience reader already uses `customer_profiles`).
- Decision Intelligence draft recommendations: `decision_recommendations.handoff_state = 'DRAFT_RECOMMENDATION'` (see `schema/decision_intelligence.ts`) is the Automation handoff seed.
- Audit: `CreateAuditLogUseCase.ts`. RBAC: `permissions.ts` + `packages/shared/src/permissions/index.ts`.
- Clock: **no dedicated clock service found** (UNKNOWN — NOT VERIFIED; `git grep -ni "class .*Clock\|IClock" -- goldplus-commerce/apps/api/src`). Pattern in use: pass `now: Date` into domain functions (see `Automation.ts`). Reuse that pattern.

## 9.10 Provider gates and status semantics
- Gate names referenced in `goldplus-commerce/apps/api/src/application/services/consent/ConsentOperationsSummaryService.ts`: `PROVIDER_DELIVERY_ENABLED`, `CUSTOMER_COMMUNICATIONS_ENABLED`, `NOTIFICATION_DELIVERY_ENABLED`. `NOTIFICATIONS_LIVE_SEND_ENABLED` — **UNKNOWN exact default/site — NOT VERIFIED**; resolve: `git grep -nE "PROVIDER_DELIVERY_ENABLED|CUSTOMER_COMMUNICATIONS_ENABLED|NOTIFICATION_DELIVERY_ENABLED|NOTIFICATIONS_LIVE_SEND_ENABLED" -- goldplus-commerce/apps/api/src`. Expected defaults: all `false` (preserve).
- Semantics (contract): DRY_RUN/DISABLED/NOT_CONFIGURED = 0 calls; QUEUED ≠ SENT; SENT only after provider success; FAILED only after an attempted call; `OUTCOME_UNKNOWN` prevents blind retry.

## 9.11 A3 sequence
See `CODEX_A3_WORK_PLAN.json` (A3.0 JSONB → A3.1 eligibility+caps → A3.2 internal effects+atomic outbox → A3.3 provider outcomes/retry/DLQ/replay → A3.4 proofs → A4 control room → A5 acceptance). Each slice lists reuse, expected/forbidden files, migration decision, invariants, tests, proof, commit message, continuation.

## 9.12 Known unknowns
| unknown | why | risk | resolve command | blocks |
|---|---|---|---|---|
| Provider gate default values + read site | not read during handover | wrong zero-call assumption | `git grep -nE "PROVIDER_DELIVERY_ENABLED|...LIVE_SEND_ENABLED" -- goldplus-commerce/apps/api/src` | A3.3 |
| Redis/BullMQ presence | not verified | may affect worker reuse | `git grep -ni "bullmq\|ioredis" -- goldplus-commerce/apps/api/src` | A3.2/A3.3 |
| Dedicated clock abstraction | none found | scattered Date() | `git grep -ni "class .*Clock\|IClock\|timeProvider" -- goldplus-commerce/apps/api/src` | A3.1 |
| Existing Automation admin route/UI | expected none | duplicate risk | `git ls-files | grep -iE "routes/admin/automation|pages/admin/automation"` | A4 |
| Note: `GtmAutomationPanel.astro` exists (measurement GTM) — **NOT** the control plane | naming collision | confusion | `git ls-files | grep -i GtmAutomationPanel` | A4 |

## 9.13 Production boundary
`ssh goldplus-prod` · `/opt/goldplus/app/goldplus-commerce` · `https://shopgoldplus.com`.
Prohibited: creating approval markers; `docker compose down`; restarting Caddy/PostgreSQL/Redis without separate approval; calling local evidence `LIVE_VERIFIED`.
