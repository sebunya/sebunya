# CODEX BOOTSTRAP PROMPT (ready to paste)

Paste the block below to Codex as its controlling instruction. It forces a read-only review gate before any edit.

---

You are continuing the GoldPlus Commerce OS on branch `phase-2-measurement-control-tower-completion`.
The app is a pnpm monorepo under `goldplus-commerce/` inside the git root. Do not rewrite completed
architecture. Do not begin editing until you have completed the review gate below.

Step 1 — Read the entire handover pack, in order:
`goldplus-commerce/docs/handover/codex/CODEX_START_HERE.md`, then CODEX_EXECUTION_STATE.json,
CODEX_PROTECTED_ASSETS_AND_INVARIANTS.md, CODEX_EVIDENCE_MANIFEST.json, CODEX_MASTER_HANDOVER.md,
CODEX_REPOSITORY_MAP.md, CODEX_A3_WORK_PLAN.json, CODEX_A3_ACCEPTANCE_CHECKLIST.md,
CODEX_COMMANDS_AND_PROOFS.md, CODEX_RISK_REGISTER.md, then
`goldplus-commerce/docs/completion/CURRENT_EXECUTION_STATE.md` and `goldplus-commerce/NEXT_WORKTREE_README.md`.

Step 2 — Verify git state (read only):
`git fetch origin phase-2-measurement-control-tower-completion`, `git branch --show-current`,
`git rev-parse HEAD`, `git rev-parse origin/phase-2-measurement-control-tower-completion` (must match the
recorded head `3fe0f13...`), `git status --short` (expect clean), `git log --oneline -12`.
Confirm the JSON docs parse and the automation symbols exist (see CODEX_START_HERE first-ten commands).

Step 3 — Produce a reuse map, list protected assets, and identify unknowns from the evidence.

Step 4 — Print this review gate BEFORE changing any code:

```
CODEX REVIEW GATE
Verified head:
Verified branch:
Tree:
Next slice:
Existing assets to reuse:
Protected assets:
Expected files to touch:
Files not expected to change:
Known unknowns:
Migration decision:
Focused tests:
Real-PG proof:
```

Step 5 — Only after the gate is complete, implement the next bounded slice (start at `A3.0`, per
CODEX_A3_WORK_PLAN.json), staying inside the declared file boundary. For each slice: implement all
applicable layers, add focused tests, run the required gates, prove real-PostgreSQL behaviour, update
`CURRENT_EXECUTION_STATE.md`, commit with the slice's exact message, push
`git push origin phase-2-measurement-control-tower-completion`, verify `local head == origin head`,
then start the next slice automatically.

Prohibited:
- inventing files or symbols not present at HEAD;
- rewriting completed modules (Fulfilment, Inventory, Customer DNA & NBA, Decision Intelligence);
- rewriting migrations 0000–0039;
- creating a second scheduler / outbox / notification router / provider adapter / consent engine /
  customer profile / audience engine / audit system / permission catalogue;
- bypassing provider gates, consent, approval or frequency caps;
- calling any local/scratch evidence `LIVE_VERIFIED`;
- creating approval markers, restarting Caddy/PostgreSQL/Redis, or `docker compose down`.

Any change outside the expected A3 file boundary requires recording (path, reason, contract affected,
test proving necessity, risk, rollback) in your working notes before editing — see
CODEX_PROTECTED_ASSETS_AND_INVARIANTS.md §11.5.
