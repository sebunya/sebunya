# Lane B — Production Attestation (read-only) and Release Gate

Date: 2026-08-02. SSH lane `goldplus-prod` reachable (BatchMode key auth).
**All actions here were READ-ONLY. Nothing on the live production system was
written, migrated, restarted, pruned, or traffic-shifted.**

## §17.1 Read-only attestation

| Item | Value |
|---|---|
| Host | `ubuntu-4gb-fsn1-1` (Hetzner) |
| Kernel | Linux 6.8.0-117-generic |
| CPUs / Memory | 2 vCPU / 3.7 GiB (3.0 GiB used, **279 MiB free**) |
| Disk (/opt) | 75 G, 29 G used, 43 G avail (41%) |
| Docker / Compose | 29.5.1 / 5.1.3 |
| Services (healthy, 13 days up) | `api-1`, `api-2`, `web-1`, `web-2` (healthy); `redis:7-alpine` (healthy); `postgres:16-alpine`; `caddy:2-alpine` |
| Current app symlink | `/opt/goldplus/app` |
| Latest release | `goldplus-hardening-prod-native-20260731-1167b3db3055` |
| Incoming staging | empty |
| **Latest backup** | `/opt/goldplus/backups/…-20260715T171926Z` — **2026-07-15, ~18 days stale** |

## Release-gate verdict: BLOCKED (not by the repository)

Lane A is complete and green (typecheck, lint 0-errors, build, full suite
**5091/5091** incl. real-PG+Redis integration, secret-scan 1450 files, migration
parity 65/65). The production DEPLOYMENT is blocked by irreducible external /
operator dependencies, per the programme's own gates:

1. **§17.4 backup freshness + restore evidence** — the newest production backup is
   18 days old and no restore has been proven. A production migration must not run
   without a fresh backup and demonstrated restore. Taking a fresh backup and
   proving a restore on a clone are operator actions.
2. **§11 bigint production-safety** — migrations 0062–0064 include an int4→int8
   table rewrite (0062) whose lock/rewrite behaviour must be measured on a
   production-like clone with real data volume before it runs live. No such clone
   is available from here, and prod has only 279 MiB free memory.
3. **§18 secret rotations unverified** — `FULL_RELEASE_READY=false`; affected
   providers (Pesapal, ZeptoMail, SMS, webhook secrets, JWT, DB password) stay
   disabled until an operator attaches rotation evidence.

Therefore the immutable-release build/stage, production migration, candidate
canary, and reversible traffic-shift were **not** performed — proceeding would
bypass a failed release gate, which the programme forbids. The honest terminal
state is `GOLDPLUS_AMAZON_GRADE_V7_ENGINEERING_COMPLETE_RELEASE_BLOCKED`.

## What an operator must do to unblock Lane B

1. Take a FRESH production backup and prove a restore (to a clone). Attach evidence.
2. Provision a production-like clone; measure the 0062 ALTER lock/rewrite window;
   set `lock_timeout`/`statement_timeout`; scan for pre-existing constraint
   violations; prepare reconciliation SQL + abort criteria.
3. Rotate the external secrets (`EXTERNAL_SECRET_ROTATION_REGISTER.md`) and attach
   evidence so `FULL_RELEASE_READY` can flip.
4. Then re-run Lane B: stage the immutable release → migration gate → isolated
   candidate → canary (health/readiness/smoke, no real PII, no charge) → reversible
   Caddy traffic-shift → observation → automatic rollback on any breach.
