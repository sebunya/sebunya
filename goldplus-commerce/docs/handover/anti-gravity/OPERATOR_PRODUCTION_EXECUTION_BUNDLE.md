# OPERATOR PRODUCTION EXECUTION BUNDLE
Generated: 2026-07-21T07:30:00Z  
Controller: GOLDPLUS_TWO_RAIL_ABSOLUTE_COMPLETION_CONTROLLER  
Mode: ENGINEERING_AND_RELEASE_PACKAGING_MODE

---

## ANTI-GRAVITY ENGINEERING SUMMARY

Rail A is **COMPLETE**. Two engineering-controlled gaps were discovered and repaired:

| Gap | Status |
|---|---|
| `measurement-paid-social.ts` never mounted | REPAIRED — `/admin/measurement/paid-social` now wired |
| `measurement-payments.ts` never mounted | REPAIRED — `/admin/measurement/payments` now wired |

All gates passed on the repaired tree:
- Security scan: PASS (1,237 files)
- Typecheck: PASS
- Build: PASS (API + Web)
- Tests: PASS (217 files / 4,144 tests)
- Architecture: PASS (10/10)

---

## NEW RELEASE IDENTITY (after route-mount repair commit)

> **This section must be completed after the commit is pushed.**  
> The prior release (`goldplus-programme-13633d86-m0048-5c6f9d25`) is superseded because  
> it does not contain the paid-social and payments route mounts.

After running the commit and computing the new freeze, update this section with:

```
Release ID:          goldplus-programme-<new-commit-sha8>-m0048-<scope-sha8>
Executable commit:   <new commit SHA from route-mount repair commit>
Release-package head: <same or later commit if freeze commit is separate>
Migration ceiling:   0048 (UNCHANGED)
Scope manifest SHA:  <recomputed>
API image tag:       goldplus-commerce-api:goldplus-programme-<token>
Web image tag:       goldplus-commerce-web:goldplus-programme-<token>
```

---

## APPROVAL REQUIREMENTS

### Old consumed marker (must be absent)
```
Path: /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7
Status: MUST BE ABSENT — operator removes manually if present
```

### New marker (operator creates manually)
```
Path:    /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_<new-release-token>
Content: APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_<new-release-token>
Owner:   root:root
Mode:    600
Type:    regular file (not symlink)
```

**Anti-Gravity never creates, modifies or removes markers.**

---

## RAIL B EXECUTION SEQUENCE

Run all scripts from `/opt/goldplus/app/goldplus-commerce` on the production-connected macOS host.

### Step 1 — Preflight

```bash
cd /opt/goldplus/app/goldplus-commerce
bash scripts/release/anti-gravity/all-modules-preflight.sh
```

Verifies: git state, old marker absent, production health baseline, current rollback image tags.

### Step 2 — Old Marker Removal (operator manual step)

```bash
# AS ROOT on production host:
ssh goldplus-prod 'ls -la /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2*'
# If present:
ssh goldplus-prod 'rm /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7'
```

### Step 3 — Create New Approval Marker (operator manual step)

```bash
# AS ROOT on production host — AFTER confirming new release identity:
ssh goldplus-prod 'echo "APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_<new-token>" > /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_<new-token> && chown root:root /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_<new-token> && chmod 600 /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_<new-token>'
```

### Step 4 — Deploy (API first, then Web)

```bash
cd /opt/goldplus/app/goldplus-commerce

export ANTI_GRAVITY_RELEASE_COMMIT="<new-executable-commit>"
export ANTI_GRAVITY_APPROVAL_MARKER_PATH="/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_<new-token>"

# Capture current rollback images BEFORE deploying:
export ROLLBACK_API_IMAGE=$(docker compose -f docker-compose.production.yml images api --format json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['Image'])" 2>/dev/null)
export ROLLBACK_WEB_IMAGE=$(docker compose -f docker-compose.production.yml images web --format json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['Image'])" 2>/dev/null)

bash scripts/release/anti-gravity/all-modules-deploy.sh
```

### Step 5 — Verify All Modules

```bash
cd /opt/goldplus/app/goldplus-commerce
bash scripts/release/anti-gravity/all-modules-verify.sh
```

### Step 6 — One-Hour Soak

```bash
cd /opt/goldplus/app/goldplus-commerce
bash scripts/release/anti-gravity/all-modules-soak.sh
```

### Step 7 — Rollback (if ANY checkpoint fails)

```bash
cd /opt/goldplus/app/goldplus-commerce
ROLLBACK_API_IMAGE="${ROLLBACK_API_IMAGE}" \
ROLLBACK_WEB_IMAGE="${ROLLBACK_WEB_IMAGE}" \
bash scripts/release/anti-gravity/all-modules-rollback.sh
```

---

## HARD PROHIBITIONS

```
NEVER run Compose from /root
NEVER use docker compose down
NEVER reboot the server
NEVER restart Caddy, PostgreSQL or Redis
NEVER create/modify/remove approval markers via scripts
NEVER print .env.production or secrets
NEVER print customer PII
NEVER create real orders, payments, promotions, activations or sends during UAT
NEVER claim success after rollback
```

---

## PLATFORM INVARIANTS TO VERIFY DURING UAT

```
✓ Catalogue/price: live API = repository = storefront (no seed prepend)
✓ Paid social route: /admin/measurement/paid-social returns 401 without token
✓ Payments route: /admin/measurement/payments returns 401 without token
✓ RBAC: all 50 admin routes deny unauthenticated requests
✓ Workers: telemetry, webhook-retries, email-jobs, recommendations, analytics-fanout running
✓ OutboxTicker: 30-second polling interval active
✓ SyntheticMonitor: 5-minute cron scheduled
✓ Provider posture: NOTIFICATIONS_DRY_RUN=true, NOTIFICATIONS_LIVE_SEND_ENABLED=false
✓ PesaPal: amount always derived from committed order; callback cannot mutate price
✓ Migration ceiling: 0048 applied (no new migrations in this repair)
✓ Zero unexplained data drift after deployment
✓ Zero unexpected external provider activity
✓ Zero unapproved module activation
```

---

## FINAL DECLARATION

Only after:
- Rail B deploy succeeds
- All-modules verify passes
- One-hour soak passes with zero failures
- Final reconciliation confirms zero drift

...may the operator declare:

```
GOLDPLUS_ALL_MODULES_LIVE_VERIFIED_DORMANT_SAFE
```

Anti-Gravity does not declare this status — the operator declares it after reviewing the evidence.
