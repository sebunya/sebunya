# CODEX RISK REGISTER (Automation A3)

Fields: risk · evidence · impact · likelihood · detection · mitigation · files · test/proof · owner · status.

## R1 — JSONB double-encoding (KNOWN DEFECT)
- Evidence: `SELECT jsonb_typeof(config) FROM automation_versions` = `string`; same for `fulfilment_tasks.items`. A2 workaround in `DrizzleAutomationRepositories.ts` (`findActiveApprovedByTrigger`).
- Impact: SQL `->>` key queries/indexes silently return null; jsonb filters miss. High.
- Likelihood: certain for any new jsonb-key query.
- Detection: `SELECT jsonb_typeof(...)`; a write→psql check.
- Mitigation: A3.0 one infra codec boundary; native writes going forward; keep legacy read compat.
- Files: `DrizzleAutomationRepositories.ts`, `db/client.ts`.
- Test/proof: A3.0 codec test + psql `jsonb_typeof='object'`.
- Owner: Codex. Status: OPEN (workaround only).

## R2 — Duplicate scheduler
- Evidence: `OutboxTicker.ts` exists. Impact: parallel schedulers / double-fire. Mitigation: reuse `OutboxTicker`; no new ticker. Test: architecture review. Status: OPEN (guard).

## R3 — Duplicate outbox
- Evidence: `outbox_events` (`schema/system.ts`), `DrizzleOutboxRepository.ts`, `ProcessOutboxBatchUseCase.ts`. Impact: two delivery ledgers. Mitigation: A3.2 links via `automation_action_executions.outbox_event_id` (already in 0039). Status: OPEN (guard).

## R4 — Duplicate provider router
- Evidence: `NotificationRouter.ts`. Mitigation: reuse only. Status: OPEN (guard).

## R5 — QUEUED treated as SENT
- Impact: false delivery claims. Mitigation: enforce status semantics; `SENT` only on adapter success. Test: A3.3 status transition tests. Status: OPEN.

## R6 — Blind retry after ambiguous provider result
- Impact: duplicate customer sends. Mitigation: `OUTCOME_UNKNOWN` state; reconcile, no auto-retry. Test: A3.3. Status: OPEN.

## R7 — Frequency-cap race
- Impact: over-sending past cap. Mitigation: transactional slot reservation (`FOR UPDATE` / unique). Proof: A3.1 two racers → one slot. Status: OPEN.

## R8 — Cap/outbox non-atomicity
- Impact: reserved slot with no intent (or vice-versa). Mitigation: single transaction. Proof: A3.2. Status: OPEN.

## R9 — Consent revoked after planning
- Impact: send to opted-out customer. Mitigation: revalidate consent at execution (even when audience snapshotted — see `AudiencePolicyMode`). Test: A3.1/A3.3. Status: OPEN.

## R10 — Approval changed after planning
- Impact: executing an unapproved/expired version. Mitigation: re-check version-scoped approval at execution and replay (`canActivate`/`isApprovalValid` in `Automation.ts`). Status: OPEN.

## R11 — Replay bypasses current gates
- Impact: replays an action that is now disallowed. Mitigation: replay re-runs the full gate. Test: A3.3. Status: OPEN.

## R12 — PII-rich outbox payload
- Impact: PII at rest / logs. Mitigation: persist stable references, render server-side at dispatch; no raw PII. Status: OPEN.

## R13 — Provider call inside route/use case
- Impact: synchronous send bypassing outbox/gates. Mitigation: providers only via the outbox processor; planning/API never call adapters. Test: A3.2/A3.4 call-counter. Status: OPEN.

## R14 — Successful effect replay
- Impact: duplicate business effect. Mitigation: `isReplayable` allows only FAILED/DEAD_LETTERED. Test: A3.3. Status: OPEN.

## R15 — Migration rewrite
- Impact: corrupts ledger 0000–0039. Mitigation: additive `0040` only. Status: OPEN (guard).

## R16 — Dirty-tree tests
- Evidence: Slice-09 artifact-scope tests + `Slice08B1AdminRouteProtectionSweep` read `git status`. Impact: false failures while uncommitted. Mitigation: commit before treating full-suite failures as real; bump admin page counts when adding A4 pages. Status: OPEN (process).

## R17 — Route-order collision
- Evidence: Hono matches registration order; prior modules registered static routes (e.g. `/report`, `/overview`) before `/:id`. Impact: `:id` shadows a static path. Mitigation: register static automation routes before `/:id` (A4). Status: OPEN.

## R18 — Registry architecture violation / DI ordering
- Evidence: prior "used before initialization" bug from member ordering in `Registry.ts`; architecture test "Application layer must not import Infrastructure layer". Impact: build break / boundary failure. Mitigation: add automation members after their dependencies; keep use cases importing ports only. Test: `tests/architecture/boundaries.test.ts`. Status: OPEN (guard).

## R19 — Local proof mislabeled production
- Impact: false LIVE_VERIFIED. Mitigation: only `ssh goldplus-prod` + shopgoldplus.com evidence is LIVE_VERIFIED; everything here is LOCAL_ACCEPTED / SOURCE_COMPLETE_NOT_DEPLOYED. Status: OPEN (process).

## R20 — Name collision: GtmAutomationPanel
- Evidence: `apps/web/src/components/admin/measurement-control-tower/GtmAutomationPanel.astro` is measurement GTM, not the control plane. Impact: Codex edits the wrong "automation" UI. Mitigation: build the control room under `apps/web/src/pages/admin/automation/*`. Status: OPEN (note).

## R21 — Provider gate defaults unverified
- Evidence: gate names found in `ConsentOperationsSummaryService.ts`; defaults/read-site UNKNOWN. Impact: wrong zero-call assumption. Mitigation: resolve with the grep in CODEX_MASTER_HANDOVER §9.10 before A3.3. Status: OPEN (unknown).
