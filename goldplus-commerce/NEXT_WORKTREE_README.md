# NEXT WORKTREE — Automation control plane (A3+) resume

Branch: `phase-2-measurement-control-tower-completion`
Resume head: `2000fce` (= origin). Clean tree. Full suite **185 files / 3,965 tests**; architecture 10/10.
Migrations proven through **0039** (fresh `0000→0039` + populated-upgrade on `launchcheck`).

Binding queue: `docs/completion/COMMERCE_OS_EXECUTION_QUEUE.json`.
Live status: `docs/completion/CURRENT_EXECUTION_STATE.md`.

## Completed (SOURCE_COMPLETE_NOT_DEPLOYED)
Fulfilment F1–F5 + admin UI · Inventory/oversell · admin order email (outbox) ·
Customer DNA & NBA (0037) · Decision Intelligence (0038).

## Automation — five independently green slices (contract switched from one big commit)
- **A1 DONE** (`a3a3146`): governed versioned domain + migration **0039**
  (`automation_definitions/versions/approvals/executions/action_executions/suppressions/events`).
- **A2 DONE** (`2000fce`): restart-safe trigger planning — PlanAutomationExecutionUseCase resolves
  audience from Customer DNA, evaluates conditions into evidence, persists one idempotent execution
  plan (unique `trigger_execution_key`) + planned actions. Real-PG proof `automation-planning-proof.ts`.
  **Note:** this stack double-encodes jsonb (even `fulfilment_tasks.items` is `jsonb_typeof=string`);
  the automation config reader normalises both encodings — reuse that pattern when querying jsonb keys.

### NEXT: A3 — consent-safe execution and replay (`Module Automation A3: add consent-safe execution and replay`)
Reuse `ProcessOutboxBatchUseCase`, `NotificationRouter`, provider adapters, `OutboxTicker`, consent,
existing retry/DLQ. **No second outbox/scheduler/router.** Build:
- A deterministic pre-flight gate in the mandated order (definition ACTIVE → version APPROVED → trigger
  valid → not expired → subject/identity safe → consent now → channel pref now → action supported →
  global pause → automation pause → frequency-cap slot → business suppression → provider configured →
  provider enabled → customer-comms enabled → notification-delivery enabled → live-send enabled),
  persisting the exact suppression reason (the full enum in §9.2 of the contract) to `automation_suppressions`.
- Transactional frequency-cap reservation (per customer/automation/channel/action-family/rolling-window/
  global) so concurrent executions never exceed the cap; document attempts-vs-sends.
- Internal actions via existing use cases (idempotent, audited). External actions persist ONE outbox
  intent (into `automation_action_executions.outbox_event_id`) — never call providers synchronously.
- Delivery semantics exactly: DRY_RUN/DISABLED/NOT_CONFIGURED/QUEUED/PROCESSING/INTERNAL_SUCCESS/SENT/
  FAILED. Replay re-evaluates the full gate; a SENT/INTERNAL_SUCCESS effect is never replayable; a
  DEAD_LETTERED action replays once as a new attempt without duplicating the effect.
- **Zero-network proof via an explicit adapter call counter / transport spy** (not "no exception"):
  DRY_RUN / PROVIDER_DISABLED / NOT_CONFIGURED / CUSTOMER_COMMUNICATIONS_DISABLED /
  NOTIFICATION_DELIVERY_DISABLED / LIVE_SEND_DISABLED → 0 calls; internal action still completes;
  QUEUED ≠ SENT.
- **Real-PG proof:** two executors race → one action execution wins, one cap reservation wins, one outbox
  intent persists; duplicate retry no double-effect; successful action non-replayable; DLQ replays once.
- Default gates stay OFF: `PROVIDER_DELIVERY_ENABLED=false, CUSTOMER_COMMUNICATIONS_ENABLED=false,
  NOTIFICATION_DELIVERY_ENABLED=false, NOTIFICATIONS_LIVE_SEND_ENABLED=false`. No approval markers.

Then **A4** (RBAC `automation.read/create/manage/approve/execute/replay` — approve & replay separately
privileged — thin Hono+Zod API + admin control room UI + observability) and **A5** (end-to-end acceptance,
migration proof, full gates, matrix evidence, mark Automation `SOURCE_COMPLETE_NOT_DEPLOYED`).

Then continue the queue: Experiments → Pricing & Promotions → Fraud Triage → PIM Import →
Shopping Assistant → Surveys → Copy Quality → Behavioural Interventions → Loyalty → Search Insights.

## Resume commands
```
cd goldplus-clean-continuation/phase-2-measurement-control-tower-completion-20260715/goldplus-commerce
git fetch origin phase-2-measurement-control-tower-completion && git status --short   # clean at 2000fce
# local PostgreSQL 16: su -s /bin/bash postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/gpdata -o '-p 55432 -k /var/lib/postgresql' start"  (launchcheck migrated through 0039)
# gates: node scripts/security/scan-secrets.mjs ; npx vitest run ; npx vitest run tests/architecture
# outbox reuse: apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase.ts ; infrastructure/notifications/NotificationRouter.ts ; infrastructure/scheduler/OutboxTicker.ts ; schema/system.ts outbox_events
```

Production deploy/UAT remain **EXTERNAL_BLOCKED**: no `ssh goldplus-prod`, no docker daemon; nothing `LIVE_VERIFIED`.
