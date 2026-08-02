# V5 Institutional Memory (Slice 0 bootstrap)

Posture: remember → verify → preserve → improve → prove → record → continue.

## Memory sources located and read

| Source | State |
|---|---|
| AGENTS.md, CLAUDE.md | present, read |
| docs/completion/GOLDPLUS_ABSOLUTE_COMPLETION_MATRIX.md, CURRENT_EXECUTION_STATE.md | present |
| NEXT_WORKTREE_README.md (repo root and app root) | present |
| docs/platform/analytics/ADVANCED_ANALYTICS_V2_* (10 files) | present — authored this programme cycle, evidence-backed |
| docs/handoff/claude-code-final/* (module truth map, UAT gap matrix, regression list) | **ABSENT from tree and from all reachable history** (`git log --all --diff-filter=A -- '**/module-truth-map.json'` → nothing). Recorded `HISTORIC_128_SOURCE_UNAVAILABLE`; the 128-row counts from the prompt are owner-intent memory only. No rows invented |
| docs/platform/{codebase-module-inventory, architecture-map, production-readiness-gap-analysis, security-and-fraud-hardening}.md | absent — replaced by source-grounded discovery |

## Historic identities verified

All five named commits exist and **are ancestors of the current head**, so
their wins are already in this line and need preservation, not porting:

| Commit | What it carries | Ancestry |
|---|---|---|
| `bbdb3e1c` | earlier handoff baseline (pre-monorepo-nesting layout) | ANCESTOR |
| `e9f3078` | Fulfilment F1–F5 checkpoint | ANCESTOR |
| `a166593` | F3 packing workspace | ANCESTOR |
| `386697e` | F4 dispatch + single stock consumption | ANCESTOR |
| `1b2cad2` | F5 delivery confirmation + reporting | ANCESTOR |

Historic fulfilment memory (migrations 0029–0036, SLA, packing, partial
fulfilment, dispatch, delivery confirmation, admin order email, reservation)
is present in the current schema/migrations chain (ceiling 0061, parity 62/62).

## Accepted current wins (do not regress)

- Advanced Analytics V2 complete stack (see ADVANCED_ANALYTICS_V2_* docs):
  Kampala-time semantics, canonical catalogue, metric states, saved views,
  alert rules (no delivery path), bounded exports, payment-attempt
  intelligence, golden datasets proven twice (pure + real PostgreSQL),
  measured EXPLAIN ANALYZE evidence.
- Checkout hardening line: fenced lease (0058), durable side effects + saga
  stages (0059), cart ownership/version (0060); proofs: durability 38/38,
  cart authorization 25/25, e2e 43/43 (executed in the prior cycle).
- Deny-by-default admin page sweep (84-page disk-derived inventory).
- Redis-backed abuse controls with cross-replica integration proof.
- Webhook verification with authoritative amount comparison and review queue.
- 4,929-test green suite, 90 architecture checks, secret scan (1391 files).

## Known V2 limitations carried into this programme's queue

Playwright not executed · scheduled alert evaluation not operational ·
cohort/retention and experiment intelligence incomplete · explorer absent ·
caching absent by evidence-driven choice · payment-attempt join flagged as
first query to degrade (16.18 ms @ 50k orders, seq-scan join).

## Environment attestation (recorded openly)

This session runs in the Claude Code remote Linux container (`uname -s` =
Linux, uid 0), not the MacBook named in §2.1 — executing on the user's
explicit instruction, as with the prior V2 cycle in this same environment.
Lane B: `ssh` binary absent → **REMOTE_RELEASE_LANE_UNAVAILABLE** per §0C.1;
Lane A continues at full strength and no local gate is weakened. No
production system is reachable or touched from here.
