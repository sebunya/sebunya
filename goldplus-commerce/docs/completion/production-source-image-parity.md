# Production Source / Image Parity

Slice 14A ELITE, 2026-07-15. This execution environment has **no `ssh goldplus-prod`
access**, so every production statement below is carried from the newest handoff
evidence (`NEXT_WORKTREE_README.md`, `docs/platform/evidence/slices/slice-10-pr2g-*`,
10-D PRIME records) and is **not re-verified this session**.

## Evidence-carried production state

| Item | Value | Evidence |
|---|---|---|
| Production source head | `bfa6de64228d6cca602c35e8d217d74cad4696c9` (clean clone, direct layout) | 10-PR2G FINAL source switch |
| Branch head (this repo) | `4b4016c` | git |
| Delta | Production is **behind** branch head — 10-D consent operations control room and later evidence commits are source-only | 10-D PRIME: `READY_NOT_DEPLOYED` |
| Caddy | Restarted alone during 10-PR2G; validated Caddyfile SHA-256 `ca560fa…` matches live | 10-PR2G |
| API/web/PostgreSQL/Redis | Containers retained exact IDs and start times (not restarted) | 10-PR2G |
| Images | Immutable digests; API/web run compiled images without source bind mounts | 10-D PRIME |
| Post-switch health | Storefront 200, API live health 200, admin redirect 303, Preference Centre 200 | 10-PR2G post-switch verification |
| Consent ledger | Exactly 4 Slice 10-C events (2 grants, 2 withdrawals), zero duplicates, zero provider callbacks, zero outbox rows, zero notification attempts | 10-PR2G read-only PG check |
| Rollback assets | Dirty source preserved at `goldplus-commerce.dirty-pre-10pr2g-…`; preservation packs with SHA-256 `bb554ea5…` | 10-PR2G |

## Parity conclusion

- **SOURCE > PRODUCTION**: all commits after `bfa6de6` (notably 10-D consent operations
  control room, R2 deploy prep, and this reconciliation) are SOURCE_COMPLETE_NOT_DEPLOYED.
- Deploying them requires: operator-approved maintenance window, reproducible API/web
  image build, scoped `docker compose --env-file .env.production -f
  docker-compose.production.yml up -d --no-deps api web`, then post-deploy health,
  logged-out protection, and read-only consent/no-send checks.
- Status: **BLOCKED_EXTERNAL** (operator approval + SSH access). Do not fabricate
  approval; do not create approval markers.

## Re-verification checklist (when SSH is available)

```bash
ssh goldplus-prod 'set -eu; cd /opt/goldplus/app/goldplus-commerce;
echo HEAD=$(git rev-parse HEAD); git status --porcelain=v1 | wc -l;
docker compose --env-file .env.production -f docker-compose.production.yml ps'
```

Never display `.env.production`, secrets, credentials, tokens, hashes, or raw identities.
