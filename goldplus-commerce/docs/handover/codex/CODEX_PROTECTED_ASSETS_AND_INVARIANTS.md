# CODEX PROTECTED ASSETS AND INVARIANTS

Codex must not replace, duplicate or rewrite the following without explicit evidence of a defect
(a failing regression test) and the change-justification block in §11.5.

## 11.1 Protected modules (paths at HEAD 3fe0f13)
- Fulfilment engine: `goldplus-commerce/apps/api/src/domain/fulfilment/*`, `.../application/use-cases/fulfilment/*`, admin UI `.../apps/web/src/pages/admin/fulfilment/*`.
- Inventory reservation / oversell: `goldplus-commerce/apps/api/src/domain/inventory/*`, `.../infrastructure/db/repositories/DrizzleInventoryRepository.ts`.
- Customer DNA: `goldplus-commerce/apps/api/src/domain/customer-dna/*`, `.../infrastructure/db/repositories/DrizzleCustomerDnaRepositories.ts`, `DrizzleCustomerSignalReader.ts`.
- NBA: `NextBestAction.ts` in `domain/customer-dna/` + `nba_decisions/nba_candidates` tables.
- Decision Intelligence: `goldplus-commerce/apps/api/src/domain/decision-intelligence/*`, `DrizzleDecisionInsightRepository.ts`, `DrizzleDecisionEvidenceReader.ts`.
- Outbox: `ProcessOutboxBatchUseCase.ts`, `DrizzleOutboxRepository.ts`, `OutboxProcessor.ts`, `OutboxTicker.ts`, `schema/system.ts` (`outbox_events`).
- NotificationRouter: `.../infrastructure/notifications/NotificationRouter.ts` + provider adapters.
- Consent: `.../application/{ports,services}/consent/*`.
- RBAC: `.../interfaces/http/middleware/permissions.ts`, `packages/shared/src/permissions/index.ts`.
- Audit: `.../application/use-cases/audit/CreateAuditLogUseCase.ts`.
- Registry composition: `.../infrastructure/Registry.ts` (extend by adding members; do not reorder existing wiring — note DI ordering caused a prior "used before initialization" bug).

**A3 EXTENDS these by adding NEW automation execution/replay use cases and repositories that CALL them.
A3 does not fork or reimplement them.**

## 11.2 Protected migrations
- Never rewrite `0000`–`0039`. New schema (if genuinely required) → additive `0040`. Verified latest: `0039_mighty_automation` (`git ls-files | grep migrations/0039_`).

## 11.3 Protected business invariants (must remain true)
- Inventory: no oversell; a not-fully-reserved order opens the fulfilment task ON_HOLD (never NEW).
- Packing: `packed <= reserved`; `packed + backordered + cancelled <= ordered`.
- Single stock-consumption transition (consume exactly once at READY_FOR_DISPATCH).
- Payment: redirect/queued does not mean paid; delivery does not auto-complete payment.
- One fulfilment task per order (idempotent).
- Decision Intelligence: one active insight per idempotency key; resolved insight not silently reopened.
- Customer DNA: identity resolved only via approved first-party signals; weak-signal merge forbidden; NO_ACTION is a valid NBA outcome.
- **Automation (A3 additions must uphold):** one execution plan per trigger idempotency key (already enforced by unique `trigger_execution_key`); one business action per action idempotency key (unique `automation_action_executions.idempotency_key`); `SENT` only after provider success; `DRY_RUN`/`DISABLED`/`NOT_CONFIGURED` = zero provider calls; no blind retry after `OUTCOME_UNKNOWN`.

## 11.4 Protected operational rules
- No approval-marker creation.
- No Caddy/PostgreSQL/Redis restart.
- No `docker compose down`.
- No raw PII logging; no persisting PII-rich rendered payloads; no hard-coded secrets/recipients/sender ids/template ids.
- Provider gates stay OFF by default: `PROVIDER_DELIVERY_ENABLED`, `CUSTOMER_COMMUNICATIONS_ENABLED`, `NOTIFICATION_DELIVERY_ENABLED`, `NOTIFICATIONS_LIVE_SEND_ENABLED` = false.
- Never label local/scratch evidence `LIVE_VERIFIED`.

## 11.5 Change-justification rule (record BEFORE editing outside the A3 boundary)
For any file not listed in the current slice's `expectedFilesToModify` (see `CODEX_A3_WORK_PLAN.json`), record:
```
Path:
Reason:
Existing contract affected:
Test proving the change is necessary:
Risk:
Rollback:
```
