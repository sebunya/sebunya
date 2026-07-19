# CURRENT EXECUTION STATE (2026-07-19 · Automation A3.2)

- The forensic handover was verified at `bfb0ffc3d004f8eecc039722f540eef75d8d7193`, then Codex completed
  C0 whole-codebase assimilation without application-source changes. The durable orientation package is
  under `docs/handover/codex/orientation/` and is committed by the documentation-only commit carrying this update.
- Branch `phase-2-measurement-control-tower-completion`; C0 baseline local HEAD equalled origin at
  `bfb0ffc3d004f8eecc039722f540eef75d8d7193` with a clean tree before documentation generation.
- Census reconciled: 1,690 tracked/classified files, 1,620 tracked/inspected text files, 70 binary/assets,
  zero unclassified. See `docs/handover/codex/orientation/CODEX_CODEBASE_CENSUS.json`.
- Automation **A1 complete** (a3a3146), **A2 complete** (2000fce), and **A3.0 implementation proven** from
  C0 head `132ff1fc04977acd87e5d5c9f0702603786267f7`. Real PostgreSQL classified the JSONB condition as
  `ACTIVE WRITE DEFECT`; the bounded adapter now writes native JSONB objects/arrays, reads at most one legacy
  layer, rejects malformed configuration, and needs no migration. A3.0 is committed/pushed at `a44f456`.
- Automation **A3.1 implementation proven** from clean A3.0 head `a44f456bc69d6d6fa0c834ff51f7d13f85d4c9de`:
  fixed fail-closed eligibility order, full exact suppression enum/persistence, and transactionally serialized durable
  cap reservation. Additive migration `0040` is required because plans/suppressions cannot safely represent reusable
  positive slots or exclude non-live outcomes. No prior migration changed.
- Automation **A3.2 implementation proven** from clean A3.1 head `74b05db5db7294eafa39d63f7297229372373d74`:
  external actions atomically reserve/reuse a cap and persist/link exactly one no-send intent in the existing outbox;
  configured fulfilment actions delegate to the existing idempotent use case, and unsupported internal families fail
  closed as NOT_CONFIGURED. Registry is wired; no provider is a dependency of the action use case.
- Other modules SOURCE_COMPLETE_NOT_DEPLOYED (Fulfilment F1-F5+UI, Inventory, Customer DNA & NBA 0037,
  Decision Intelligence 0038). Migrations proven through **0039** (REPORTED — rerun per handover).
- Production status: not reclassified by C0; nothing is newly claimed `LIVE_VERIFIED`.
- Codex entry point: `docs/handover/codex/CODEX_START_HERE.md` then `CODEX_BOOTSTRAP_PROMPT.md`.
- A3.0 proof: focused 23/23, architecture 10/10, typecheck/build/secret scan and fresh `0000`-`0039` replay
  passed; the PostgreSQL planning proof reports native object/array types, legacy semantic equality, malformed
  rejection, concurrency/idempotency, and zero provider calls. The dirty-tree full suite passed 3,959/3,971;
  its 12 failures are historical artifact allowlist guards and must be rerun from the clean A3.0 commit.
- A3.1 proof: focused 44/44, fresh replay through `0040`, populated `0039`→`0040` upgrade, and a real-PostgreSQL
  two-racer proof passed with one reservation, one exact capped suppression, winner retry slot reuse, and zero
  provider calls. Workspace typecheck, architecture 10/10, API/web build, secret scan, focused lint, and diff check pass.
- A3.2 proof: five focused Automation files / 50 tests and a real-PostgreSQL two-executor race pass with one
  QUEUED action, one cap, one linked native-JSONB outbox intent, `no_send_guarantee=true`, and zero provider calls.
  Typecheck, architecture 10/10, build, secret scan, focused lint, and diff check pass; no migration was added.
- Next gate: commit A3.2, run the clean-tree full suite, push/alignment verification, then begin **A3.3**. Reuse the
  existing router/outbox/ticker and retry/DLQ path; add truthful SENT/FAILED/OUTCOME_UNKNOWN reconciliation and
  gate-revalidated replay without synchronous provider calls or duplicate cap slots.

---
