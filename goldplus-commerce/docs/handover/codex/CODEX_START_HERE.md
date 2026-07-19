# CODEX START HERE — Automation A3 handover

**You are continuing an existing, heavily implemented GoldPlus Commerce OS. Do NOT rewrite it.**
This pack is self-contained: you do not need any prior conversation or model memory.

## Verified repository identity (at handover)
- Git root: `/home/user/sebunya/goldplus-clean-continuation/phase-2-measurement-control-tower-completion-20260715`
- App subdir (monorepo): `goldplus-commerce/` — **all app paths are prefixed `goldplus-commerce/`**
- Branch: `phase-2-measurement-control-tower-completion`
- Verified HEAD: `3fe0f13218355bfe273348a75b6b77c845015637`
- Origin HEAD: `3fe0f13218355bfe273348a75b6b77c845015637` (local == origin)
- Tree: **clean** at handover
- Handover commit: **this commit** (`Docs: add forensic Codex handover for Automation A3`)
- Latest migration: `0039_mighty_automation`
- Node `v22.22.2`, pnpm `10.33.0` (verified)

## Where we are
- Current module: **Automation** (internal-first control plane).
- Completed Automation slices: **A1** (`a3a3146`, governed versioned domain + migration 0039) and **A2** (`2000fce`, restart-safe trigger planning + real-PG proof).
- **Next bounded slice: `A3.0` — Automation JSONB compatibility and normalization.**
- Truthful source status: Automation is **SOURCE_PARTIAL** (A1+A2 only; A3–A5 NOT started). Other modules (Fulfilment, Inventory, Customer DNA & NBA, Decision Intelligence) are **SOURCE_COMPLETE_NOT_DEPLOYED**.
- Production status: **EXTERNAL_BLOCKED** — no `ssh goldplus-prod`, no docker daemon; **nothing is LIVE_VERIFIED**.
- Reported (NOT rerun during handover): 185 test files / 3,965 tests; architecture 10/10; fresh replay + populated upgrade through 0039.

## Required reading order
1. `CODEX_START_HERE.md` (this file)
2. `CODEX_EXECUTION_STATE.json`
3. `CODEX_PROTECTED_ASSETS_AND_INVARIANTS.md`
4. `CODEX_EVIDENCE_MANIFEST.json`
5. `CODEX_MASTER_HANDOVER.md`
6. `CODEX_REPOSITORY_MAP.md`
7. `CODEX_A3_WORK_PLAN.json`
8. `CODEX_A3_ACCEPTANCE_CHECKLIST.md`
9. `CODEX_COMMANDS_AND_PROOFS.md`
10. `CODEX_RISK_REGISTER.md`
11. `../../completion/CURRENT_EXECUTION_STATE.md`
12. `../../../NEXT_WORKTREE_README.md`
13. `../../completion/COMMERCE_OS_EXECUTION_QUEUE.json`

## First ten commands — READ-ONLY verification (no edits before these)
```bash
cd <git-root>
git fetch origin phase-2-measurement-control-tower-completion            # 1
git branch --show-current                                                # 2 -> phase-2-measurement-control-tower-completion
git status --branch --short                                              # 3 -> clean, up to date
git rev-parse HEAD                                                        # 4 -> 3fe0f13...
git rev-parse origin/phase-2-measurement-control-tower-completion        # 5 -> must equal #4
git log --oneline -12                                                    # 6 -> shows 2000fce, a3a3146, 480a2ba
node -e "['CODEX_EXECUTION_STATE.json','CODEX_EVIDENCE_MANIFEST.json','CODEX_A3_WORK_PLAN.json'].forEach(f=>JSON.parse(require('fs').readFileSync('goldplus-commerce/docs/handover/codex/'+f,'utf8')));console.log('json ok')" # 7
git grep -n "class PlanAutomationExecutionUseCase" -- goldplus-commerce/apps/api/src   # 8 -> A2 present
git grep -n "pgTable('outbox_events'" -- goldplus-commerce/apps/api/src                # 9 -> reuse outbox
git diff --check                                                         # 10 -> no whitespace errors
```

## Hard safety rules
- Never rewrite migrations `0000`–`0039`. If a schema change is genuinely required, add `0040`.
- Do NOT create a second scheduler, outbox, notification router, provider adapter, consent engine, customer profile, audience engine, audit system or permission catalogue — **reuse** the ones in the evidence manifest.
- Provider gates stay OFF by default. `DRY_RUN` / `DISABLED` / `NOT_CONFIGURED` make **zero** provider/network calls — prove it with an explicit adapter call counter, not "no exception".
- `QUEUED` is not `SENT`. `SENT` only after a real provider success. Ambiguous acceptance = `OUTCOME_UNKNOWN` and must not be blindly retried.
- Do NOT create approval markers, restart Caddy/PostgreSQL/Redis, run `docker compose down`, log raw PII, or call local evidence `LIVE_VERIFIED`.

## Do-not-touch warning
See `CODEX_PROTECTED_ASSETS_AND_INVARIANTS.md`. Any edit outside the A3 file boundary requires the change-justification block recorded there **before** editing.

## Continuation rule
Complete each bounded slice (A3.0 → A3.1 → A3.2 → A3.3 → A3.4 → A4 → A5), leaving the repo green, committing and pushing each, verifying `local head == origin head`, then start the next slice. A successful commit is a continuation boundary, not a stop. After A5, continue the `COMMERCE_OS_EXECUTION_QUEUE.json` (Experiments next).
