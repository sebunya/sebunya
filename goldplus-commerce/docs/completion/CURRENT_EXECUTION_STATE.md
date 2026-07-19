# CURRENT EXECUTION STATE (2026-07-19 · Automation A2 committed)

- head at A2 (= origin after push); clean tree. Migrations through **0039** (fresh 0000-0039 + populated upgrade).
- Automation **A1** (governed versioned domain + migration 0039) and **A2** (restart-safe trigger planning)
  committed. A2: PlanAutomationExecutionUseCase resolves audience from Customer DNA, evaluates conditions
  into evidence, persists one idempotent execution plan (unique trigger_execution_key) + planned actions;
  real-PG proof `automation-planning-proof.ts` PASS (two planners -> one plan; duplicate ignored;
  ineligible/no-profile truthful). NOTE: this stack double-encodes jsonb; the automation config reader
  normalises both encodings.
- NEXT slice: **A3** consent-safe execution + outbox + retry/DLQ + replay. Deterministic pre-flight gate
  order + suppression reasons; transactional frequency-cap reservation; internal actions via existing use
  cases; external actions enqueue ONE outbox intent (reuse ProcessOutboxBatchUseCase/NotificationRouter,
  never sync). Explicit call-counter zero-network proof for DRY_RUN/DISABLED/NOT_CONFIGURED/*_DISABLED;
  real-PG proof (two executors -> one action/one cap slot/one outbox intent; successful non-replayable;
  DLQ replays once). Commit `Module Automation A3: add consent-safe execution and replay`.

---

