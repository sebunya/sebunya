# OPERATOR PRODUCTION EXECUTION BUNDLE
Generated: 2026-07-21T08:35:00Z  
Controller: GOLDPLUS_TWO_RAIL_ABSOLUTE_COMPLETION_CONTROLLER  
Mode: ENGINEERING_AND_RELEASE_PACKAGING_MODE

---

## CANONICAL RELEASE IDENTITY

```
Release ID:          ${releaseId}
Release Token:       ${token}
Executable Commit:   ${commit}
Scope SHA-256:       ${scopeSha}
Migration Ceiling:   0048 (UNCHANGED)
Retired Candidates:  goldplus-programme-99563666-m0048-8343ee36, goldplus-programme-13633d86-m0048-5c6f9d25
```

---

## APPROVAL REQUIREMENTS

### Retired prior markers (must be absent)
```
Path: /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_99563666-m0048-8343ee36
Path: /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7
```

### New canonical marker (operator creates manually on production host)
```
Path:    /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_${token}
Content: APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_${token}
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

### Step 2 — Remove Retired Markers (operator manual step)

```bash
# AS ROOT on production host:
ssh goldplus-prod 'rm -f /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_99563666*'
ssh goldplus-prod 'rm -f /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2*'
```

### Step 3 — Create New Canonical Approval Marker (operator manual step)

```bash
# AS ROOT on production host:
ssh goldplus-prod 'echo "APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_${token}" > /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_${token} && chown root:root /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_${token} && chmod 600 /root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_${token}'
```

### Step 4 — Backup Rehearsal

```bash
cd /opt/goldplus/app/goldplus-commerce
bash scripts/release/anti-gravity/all-modules-backup-rehearsal.sh
```

### Step 5 — Verify Scope Integrity

```bash
cd /opt/goldplus/app/goldplus-commerce
node scripts/release/anti-gravity/verify-release-scope.mjs
```

### Step 6 — Deploy (API first, then Web)

```bash
cd /opt/goldplus/app/goldplus-commerce
export ANTI_GRAVITY_RELEASE_COMMIT="${commit}"
export ANTI_GRAVITY_APPROVAL_MARKER_PATH="/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_${token}"
bash scripts/release/anti-gravity/all-modules-deploy.sh
```

### Step 7 — Verify All Modules

```bash
cd /opt/goldplus/app/goldplus-commerce
bash scripts/release/anti-gravity/all-modules-verify.sh
```

### Step 8 — Shadow Canary Rehearsal

```bash
cd /opt/goldplus/app/goldplus-commerce
bash scripts/release/anti-gravity/all-modules-shadow-canary.sh
```

### Step 9 — One-Hour Soak

```bash
cd /opt/goldplus/app/goldplus-commerce
bash scripts/release/anti-gravity/all-modules-soak.sh
```

### Step 10 — Rollback (if ANY checkpoint fails)

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
