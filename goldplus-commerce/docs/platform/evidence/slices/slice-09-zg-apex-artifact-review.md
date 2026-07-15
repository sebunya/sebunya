# Slice 9-ZG APEX artifact review

## Allowed changes

| Area | Files | Purpose |
|---|---:|---|
| Diagnostic response classifier | 1 | Bounded provider classification and redaction |
| Internal diagnostic guard | 1 | Pure one-attempt, allowlist and red-line authorization |
| Diagnostic transport | 1 | Response capture without secret exposure |
| Focused tests | 2 | Guard, transport, redaction and regression coverage |
| Evidence | 6 | Transport, guard, attempt, no-send, rollback and review records |

No env, secret, migration, schema, route, package, web, checkout/payment, order, auth/RBAC, queue/outbox, SMS, WhatsApp, campaign, provider broad activation, loyalty, offer, reward, discount or coupon file changed.

## Production review

- Source and PostgreSQL backups completed and verified before overlay/audit writes.
- Only API was rebuilt/recreated; two API replicas healthy.
- One synthetic guarded diagnostic authorization occurred.
- One pre-send audit and one classified post-result audit were recorded; all audit hashes are present.
- No provider HTTP request or confirmed send occurred.
- Synthetic withdrawal completed and post-run gates are locked.
- Public/health smoke: home, preferences and readiness `200`; admin `303`; protected readiness API `401`.

## Verification record

- Slice 9-ZG focused suite: 173 tests passed.
- Slice 9-ZF focused suite: 140 tests passed.
- Slice 9-Z APEX suite: 231 tests passed after clean commit.
- API/root typecheck: passed.
- Secret scan: passed across 904 source/config files; values were not printed.
- Root lint: zero errors; existing warnings remain 598 API and 21 web.
- API/web build: passed.
- Mandated protected suites: 6 files and 1,188 tests passed from a clean commit.
- Full suite: 151 files and 2,976 tests passed.

## Decision

Diagnostic transport and guard are implemented. The one permitted internal diagnostic attempt failed locally before provider transport and was classified as `transport_adapter_bug`; no retry was made. Decision: `SLICE_9_ZG_APEX_EMAIL_DIAGNOSTIC_CANARY_FAILED_CLASSIFIED`, subject to push verification.
