# NEXT_RESUME — read this before acting after any interruption/compaction
Updated 2026-08-03 · SHA `707876d` · phase 0→1.

1. Verify: branch `claude/amazon-grade-goldplus-commerce-os-v5-production-20260802`, clean tree, HEAD ≥ `707876d`.
2. Read `EXECUTION_STATE.json` — statuses there are authoritative; do NOT re-plan or re-scan the repo (indexes live in this directory).
3. Continue from the first non-GREEN work unit in EXECUTION_STATE.workUnits (S1 governed-admin sync → S2 cart 180d → S3 regression guards → S4 maturity matrix → S5 release).
4. Checkpoint ritual at every green: update memory docs if facts changed → run focused gate → commit → push (updates PR #9) → update EXECUTION_STATE.lastGreenHead → continue.
5. Prod release recipe (S5): on `goldplus-prod` in `/opt/goldplus/app/goldplus-commerce`: `git fetch && git checkout <sha>` → `docker compose -f docker-compose.production.yml --env-file .env.production build api web` → `up -d api web` → wait 4 replicas healthy → verify `https://api.shopgoldplus.com/health/ready`, cart mint+add E2E, admin sweep. Rollback images tagged `rollback-*`.
6. Never: hand-SQL permission grants (use the S1 sync), real provider sends, prod load tests, `--user root` unless migration EACCES recurs.
