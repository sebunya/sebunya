# Rollback Plan

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, read-only audit only.

## General Rollback Discipline

- Never use `git add .`.
- Stage exact files only.
- Keep each implementation pass small enough to revert with a single targeted patch.
- Do not combine deployment, dependency, and behavior changes in one pass.
- For protected recommendation files, require before/after tests and an explicit rollback note before approval.

## Documentation Rollback

This audit added files under `docs/refactor/`. If these docs need to be removed, delete only that directory after approval.

## Code Pass Rollback

For each future pass:

1. Record files changed.
2. Run relevant tests before and after.
3. If a regression is found, revert only files in that pass.
4. Re-run the failing test plus the pass gate.
5. Do not revert pre-existing dirty worktree changes unless explicitly approved.

## Deployment Rollback

- Keep previous `docker-compose.production.yml` and `Caddyfile` content available in git diff.
- Validate rollback with `docker compose -f docker-compose.production.yml config`.
- For production, prefer service-level rollback or start-first update rollback where supported.
- Do not touch certificates manually unless the TLS issue is specifically certificate-store related.

## Database Rollback

- Do not change schema in early refactor passes.
- If schema change becomes necessary, require:
  - forward migration
  - rollback migration or compensating migration
  - backup point
  - production data impact analysis
  - dry-run on staging

## Dependency Rollback

- Treat `package.json` and `pnpm-lock.yaml` as one unit.
- If an upgrade breaks build/test, revert both files exactly.
- Do not mix dependency upgrades with source refactors.

## Protected System Rollback

- Avoid touching protected recommendation systems.
- If a verified bug requires protected code changes:
  - capture failing test first
  - make minimal diff
  - prove placement keys, event names, storage keys, payload shape, and scoring behavior are preserved or intentionally changed
  - include exact rollback command/files in the pass report

