# CODEX COMMANDS AND PROOFS (verified)

All scripts below were confirmed present at HEAD via `git ls-files` / `goldplus-commerce/package.json`.
Run gates from the app root `goldplus-commerce/` unless noted. Never label local output `LIVE_VERIFIED`.

## Pre-flight (read only)
```bash
git fetch origin phase-2-measurement-control-tower-completion
git branch --show-current            # expect: phase-2-measurement-control-tower-completion
git rev-parse HEAD; git rev-parse origin/phase-2-measurement-control-tower-completion   # must match
git status --short                   # expect: clean
git log --oneline -12
```
Success signal: HEAD == origin, clean tree. Failure: any mismatch → STOP and reconcile (do not reset/discard).

## Read-only source inspection
```bash
git grep -n "class PlanAutomationExecutionUseCase" -- goldplus-commerce/apps/api/src
git grep -n "pgTable('outbox_events'" -- goldplus-commerce/apps/api/src
git ls-files | grep -iE "routes/admin/automation|pages/admin/automation"   # expect empty (A4 not done)
git grep -nE "PROVIDER_DELIVERY_ENABLED|CUSTOMER_COMMUNICATIONS_ENABLED|NOTIFICATION_DELIVERY_ENABLED|NOTIFICATIONS_LIVE_SEND_ENABLED" -- goldplus-commerce/apps/api/src
git grep -ni "bullmq\|ioredis" -- goldplus-commerce/apps/api/src            # resolve worker/queue unknown
```

## Automation focused tests
```bash
cd goldplus-commerce
npx vitest run tests/unit/AutomationA1Domain.test.ts     # expect 10 passed
npx vitest run tests/unit/AutomationA2Planning.test.ts   # expect 7 passed
```

## API typecheck
```bash
cd goldplus-commerce/apps/api && npx tsc --noEmit        # expect exit 0
```

## Web build (A4 UI proof)
```bash
cd goldplus-commerce/apps/web && npx astro build         # expect "Complete!" exit 0
```

## Architecture tests
```bash
cd goldplus-commerce && npx vitest run tests/architecture   # expect all passed (reported 10/10)
```

## Secret scan
```bash
cd goldplus-commerce && node scripts/security/scan-secrets.mjs   # expect "Secret scan passed"
```

## Full suite (do NOT run just for docs)
```bash
cd goldplus-commerce && npx vitest run                    # REPORTED 185 files / 3,965 tests
```

## Migration status / apply / fresh replay / populated upgrade
Local PostgreSQL 16 (this environment):
```bash
su -s /bin/bash postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/gpdata -o '-p 55432 -k /var/lib/postgresql' start"
```
DB `launchcheck` (role `gp`) is migrated through 0039. Apply / prove:
```bash
cd goldplus-commerce/apps/api
ENV='DATABASE_URL=postgres://gp@127.0.0.1:55432/launchcheck JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx IDENTITY_HASH_PEPPER=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy MTN_WEBHOOK_SECRET=x AIRTEL_WEBHOOK_SECRET=y PUBLIC_API_BASE_URL=http://127.0.0.1:3000 NODE_ENV=development'
env $ENV npx tsx src/infrastructure/db/migrations/migrate.ts     # populated upgrade (expect "Migrations complete!")
# fresh replay:
/usr/lib/postgresql/16/bin/psql "postgres://gp@127.0.0.1:55432/postgres" -c "DROP DATABASE IF EXISTS afresh;" -c "CREATE DATABASE afresh OWNER gp;"
env DATABASE_URL=postgres://gp@127.0.0.1:55432/afresh JWT_SECRET=... IDENTITY_HASH_PEPPER=... MTN_WEBHOOK_SECRET=x AIRTEL_WEBHOOK_SECRET=y PUBLIC_API_BASE_URL=http://127.0.0.1:3000 NODE_ENV=development npx tsx src/infrastructure/db/migrations/migrate.ts
```
Note: the migrator applies by folder timestamp and prints "Skipped 4 known-invalid historical 0018 statement(s); migration 0028 applied the repair." — expected.

## A2 real-PostgreSQL proof (existing)
```bash
cd goldplus-commerce/apps/api
env $ENV npx tsx src/scripts/automation-planning-proof.ts    # expect verdict PASS; self-cleans
```

## Future A3 proof locations (create under scripts/, names UNKNOWN — VERIFY)
- A3.1: cap-race proof (two racers → one slot).
- A3.2: one-action-one-outbox proof (two executors → one intent).
- A3.3: retry/DLQ/replay proof (non-replayable success; DLQ replays once).
- A3.4: zero-network call-counter proof (transport spy → 0 calls per disabled gate).
Put them at `goldplus-commerce/apps/api/src/scripts/automation-*-proof.ts`, mirroring `automation-planning-proof.ts` (refuse `NODE_ENV=production`, self-clean).

## JSON validation
```bash
cd <git-root>
node -e "['CODEX_EXECUTION_STATE.json','CODEX_EVIDENCE_MANIFEST.json','CODEX_A3_WORK_PLAN.json'].forEach(f=>{JSON.parse(require('fs').readFileSync('goldplus-commerce/docs/handover/codex/'+f,'utf8'));console.log(f,'valid')})"
```

## File-reference validation (evidence manifest exists:true)
```bash
node -e "const m=require('./goldplus-commerce/docs/handover/codex/CODEX_EVIDENCE_MANIFEST.json');const fs=require('fs');let bad=0;for(const e of m.files){if(e.exists&&!fs.existsSync(e.path)){console.log('MISSING',e.path);bad++}}console.log(bad?'FAIL':'all exist')"
```

## Git diff review / commit / push
```bash
git status --short; git diff --stat; git diff --name-only; git diff --check
git commit -m "<exact slice message>"
git push origin phase-2-measurement-control-tower-completion
git rev-parse HEAD; git rev-parse origin/phase-2-measurement-control-tower-completion   # must match
```

## Production boundary (do not run here)
`ssh goldplus-prod` → `/opt/goldplus/app/goldplus-commerce`; UAT `https://shopgoldplus.com`. EXTERNAL_BLOCKED in this environment. No approval markers, no `docker compose down`, no Caddy/PG/Redis restart.
