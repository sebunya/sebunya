# CODEX A3 ACCEPTANCE CHECKLIST

Tick only with evidence (path + command + result). Do not mark a box from assumption.

## Review gate (before any edit)
- [ ] Verified branch = `phase-2-measurement-control-tower-completion`
- [ ] Verified HEAD == origin HEAD (== `3fe0f13...` or a reviewed descendant)
- [ ] Tree clean (`git status --short`)
- [ ] All handover JSON parses
- [ ] All referenced files in the evidence manifest exist (`exists:true`)
- [ ] Printed the CODEX REVIEW GATE block

## A3.0 — JSONB compatibility and normalization
- [x] New Automation jsonb write stored natively (`AutomationJsonbCodec.ts`; PostgreSQL proof: object/object/array)
- [x] Legacy string-encoded jsonb still reads correctly (`legacySemanticMatch=true`)
- [x] Malformed jsonb rejected (not silently coerced) (`malformedRejected=true`)
- [x] One compatibility boundary (no scattered parsing); no platform-wide rewrite
- [x] Focused codec test green; `apps/api` tsc clean (A3.0: 23/23; clean full suite 3,971/3,971)

## A3.1 — eligibility gates and frequency-cap reservation
- [x] Deterministic gate order persisted and auditable (`evaluateAutomationEligibility`; exact suppression rows)
- [x] Every rejection persists an exact suppression reason (full eleven-value enum), not "blocked"
- [x] Cap slot reserved only after non-provider gates pass (`EvaluateExecutionEligibilityUseCase`)
- [x] Two cap racers → exactly one slot (real-PG: one reservation, one capped suppression)
- [x] DRY_RUN / DISABLED / NOT_CONFIGURED / SUPPRESSED consume no slot (focused unit proof)
- [x] Migration decision recorded (`0040` required; fresh and populated upgrade passed)

## A3.2 — internal effects and atomic outbox intents
- [ ] Internal actions run through existing use cases; idempotent + audited
- [ ] External action persists exactly one outbox intent (reuse `ProcessOutboxBatchUseCase`)
- [ ] Cap reservation and outbox intent created atomically (one transaction)
- [ ] One action → one outbox intent (real-PG; two executors → one)
- [ ] No provider call from any route/use case

## A3.3 — provider outcomes, retry, DLQ, reconciliation, replay
- [ ] QUEUED ≠ SENT
- [ ] SENT only after provider success
- [ ] FAILED only after an attempted provider call
- [ ] Ambiguous acceptance → OUTCOME_UNKNOWN
- [ ] OUTCOME_UNKNOWN not blindly retried (retains slot until reconciliation)
- [ ] Successful effect is non-replayable
- [ ] DLQ replay re-evaluates the full gate and reuses the original cap slot
- [ ] Reuse existing retry/backoff/DLQ (no second retry engine)

## A3.4 — safety, concurrency, crash proofs
- [ ] Explicit adapter call-counter proof: DRY_RUN / PROVIDER_DISABLED / NOT_CONFIGURED / CUSTOMER_COMMUNICATIONS_DISABLED / NOTIFICATION_DELIVERY_DISABLED / LIVE_SEND_DISABLED → 0 calls
- [ ] Internal action still completes while providers disabled
- [ ] Two executors → one action / one cap / one outbox intent
- [ ] Expired lease / crash window becomes processable again
- [ ] No orphan action/evidence/event rows

## A4 — control room
- [ ] Permissions `automation.read/create/manage/approve/execute/replay` added; approve & replay separately privileged
- [ ] Thin Hono+Zod API for overview/definitions/versioning/submit/approve/reject/activate/pause/resume/dry-run/execute/executions/replay with precise errors
- [ ] Protected admin UI (real API, no mock executions, no static readiness); truthful states
- [ ] Dynamic admin routes guarded (`readSessionToken` + 303); protection-sweep counts bumped
- [ ] Observability metrics (no PII labels)
- [ ] Web build passes; RBAC fails closed

## A5 — end-to-end acceptance
- [ ] Draft→version→submit→approve→activate→trigger→plan→internal action→DRY_RUN external→pause→resume→provider-gated result→DLQ→replay all exercised locally
- [ ] Fresh migration replay through latest
- [ ] Populated pre-migration upgrade
- [ ] RBAC + audit + idempotency proven
- [ ] Matrix + queue + state docs updated; Automation marked `SOURCE_COMPLETE_NOT_DEPLOYED`

## Documentation / state / git
- [ ] `CURRENT_EXECUTION_STATE.md` updated each slice
- [ ] A3 never described as implemented until it is
- [ ] `git diff --check` clean; commit pushed; `local head == origin head`
- [ ] Full gates before A5 commit: `node scripts/security/scan-secrets.mjs`, `tsc`, build, `npx vitest run`, `npx vitest run tests/architecture`
