# Slice 9-ZI PRIME rate-limit recovery

## Decision

`SLICE_9_ZI_PRIME_RATE_LIMIT_RECOVERY_READY_CANARY_DEFERRED`

The previous transactional email diagnostic returned HTTP 429 (`rate_limited`). The provider response contained no safely usable Retry-After or reset window, so the canary is deferred by default. No retry was attempted in this slice.

## Delivered

- Pure rate-limit response parser with safe Retry-After and reset extraction.
- Request identifiers are hashed; raw headers and provider payloads are never exposed.
- Cooldown decision service returns active/elapsed/unknown, next eligibility, budget and safe-to-attempt status.
- One-attempt deferred canary guard.
- Internal-only readiness status with broad sends and public saves permanently false.
- Diagnostic transport now carries redacted retry metadata fields.

## Runtime status

Production API overlay was rebuilt and restarted on two API replicas. Production status reported `cooldown_status=unknown`, `safe_to_attempt_now=false`, and `attempt_budget_remaining=1`. No provider request was made during 9-ZI.
