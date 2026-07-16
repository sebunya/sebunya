# Slice 1B — Account-level login lockout + timing hardening

Date: 2026-07-15 · Branch: `phase-2-measurement-control-tower-completion`

## Audit findings (Slice 1 residual)

1. No account-level lockout existed — only the global 1000 req/min per-IP limiter,
   which permits high-rate credential brute force.
2. Timing side-channel: unknown emails returned before any hash verification,
   leaking registration status through response time.
3. Self-serve password recovery requires outbound email, which is provider-gated
   (delivery flags false) — recorded BLOCKED_EXTERNAL; admin-assisted reset exists
   in user management.

## Repairs

- Pure domain `domain/identity/LoginThrottle.ts`: 5 failures per (email, ip) within
  15 minutes lock the pair for 15 minutes; deterministic evaluation over failure
  timestamps; canonical lowercased key.
- `AuthenticateUserUseCase` gains an optional `ILoginAttemptStore` (fully
  backwards-compatible): locked pairs get `LOCKED` + retryAfterSeconds before any
  credential check; failures (including unknown emails) increment the counter;
  success clears it; unknown emails now verify against a real dummy hash so timing
  no longer reveals registration.
- `InMemoryLoginAttemptStore` (pruned, process-local — same pattern as the
  middleware limiter), wired via Registry into `/auth/login` and `/auth/admin/login`,
  which return 429 + `Retry-After` when locked.
- Both login endpoints additionally get a tight 10 req/min per-IP budget on top of
  the global limiter.
- Tests: `Slice01BLoginLockout.test.ts` (8) — window/expiry math, key canonicalisation,
  lock despite correct password, per-IP scoping, success reset, unknown-email counting
  with generic message, storeless backwards compatibility; existing
  `AuthenticateUserUseCase` suite still green.
