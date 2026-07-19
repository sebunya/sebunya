# NEXT WORKTREE — Commerce OS matrix execution resume

Branch: `phase-2-measurement-control-tower-completion`
Resume head: `480a2ba` (= origin). Clean tree. Full suite **184 files / 3,948 tests**; architecture 10/10.
Migrations proven through **0038** (fresh `0000→0038` + populated-upgrade on `launchcheck`).

Binding queue: `docs/completion/COMMERCE_OS_EXECUTION_QUEUE.json`.
Reconciled matrix: `docs/completion/GOLDPLUS_ABSOLUTE_COMPLETION_MATRIX.md` (+ `.json`).

## Completed (SOURCE_COMPLETE_NOT_DEPLOYED)
- Fulfilment F1–F5 + dispatch/delivery/report admin UI.
- Inventory reservation/oversell; transactional admin order email (outbox/retry/DLQ/replay).
- **Customer DNA & NBA** — migration 0037, real-PG proof, protected admin UI.
- **Decision Intelligence** — migration 0038 (`decision_policies/insights/evidence/recommendations/
  assignments/events`); two-phase evidence-first evaluator (10 signals), idempotent insights,
  optimistic-version workflow (acknowledge/assign/start/resolve/dismiss/recompute), overview,
  RBAC (`decision_intelligence.read/evaluate/assign/manage`), admin UI
  (`/admin/decision-intelligence` + `[id]`). Proof `decision-intelligence-proof.ts` PASS.

## NEXT module: Automation (Priority 1) — complete through A1–A5 (single "Module Automation" commit)
Reuse the EXISTING outbox, workers/tickers, notification router, provider gates, consent,
Customer DNA/NBA, Decision Intelligence DRAFT_RECOMMENDATION handoff, audience logic, audit, RBAC.
**Do not create a second scheduler or outbox.**
- **A1** domain + versioning + trigger/condition/action contract + migration **0039**
  (e.g. `automation_definitions`, `automation_versions`, `automation_runs`, `automation_actions`,
  `automation_suppressions`). Approval state, pause/resume, frequency cap, consent, provider readiness.
- **A2** evaluator/executor on the existing scheduler + outbox (enqueue only; no new queue).
- **A3** consent + suppression + frequency caps + provider readiness; `DRY_RUN` makes **zero** network
  calls — prove with a real-PG no-send proof (counters stay at 0).
- **A4** thin Hono API + RBAC (`automation.read/manage/approve/execute` or reuse) + admin UI with
  pause/resume/manual replay; truthful states.
- **A5** domain+use-case+repo tests, migration replay proof, full gates, evidence, commit
  `Module Automation: ...`, push, verify head==origin.

Then continue the queue: Experiments → Pricing & Promotions → Fraud Triage → PIM Import →
Shopping Assistant → Surveys → Copy Quality → Behavioural Interventions → Loyalty → Search Insights
(reconcile each against real code first; Fraud Triage / Shopping Assistant / Loyalty / Search Insights
are currently SOURCE_PARTIAL — reconcile before rebuilding).

## Resume commands
```
cd goldplus-clean-continuation/phase-2-measurement-control-tower-completion-20260715/goldplus-commerce
git fetch origin phase-2-measurement-control-tower-completion && git status --short   # clean at 480a2ba
# local PostgreSQL 16 (proofs): su -s /bin/bash postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/gpdata -o '-p 55432 -k /var/lib/postgresql' start"
#   DB launchcheck populated at migration ledger through 0038.
# gates: node scripts/security/scan-secrets.mjs ; npx vitest run ; npx vitest run tests/architecture
# migrate: (in apps/api) env DATABASE_URL=postgres://gp@127.0.0.1:55432/launchcheck JWT_SECRET=... IDENTITY_HASH_PEPPER=... MTN_WEBHOOK_SECRET=x AIRTEL_WEBHOOK_SECRET=y PUBLIC_API_BASE_URL=http://127.0.0.1:3000 NODE_ENV=development npx tsx src/infrastructure/db/migrations/migrate.ts
```

Production deploy/UAT remain **EXTERNAL_BLOCKED**: no `ssh goldplus-prod` binary and no docker
daemon in this container; nothing is `LIVE_VERIFIED`. Do not create operator approval markers.
