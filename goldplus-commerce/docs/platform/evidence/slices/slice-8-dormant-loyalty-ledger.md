# Slice 8 — Dormant loyalty ledger (source-complete, feature-gated)

Date: 2026-07-15 · Branch: `phase-2-measurement-control-tower-completion`

## Activation posture (unchanged)

The customer loyalty page keeps its truthful "being prepared" state. Every ledger
mutation requires BOTH `LOYALTY_PROGRAMME_ENABLED=true` (environment, not set
anywhere) AND the admin config switch. This commit turns nothing on. No fake points:
earns require a real orderId; rate 0 yields 0 points.

## Layers

- Pure domain `domain/loyalty/LoyaltyLedger.ts`: entry types earn/redeem/reversal/
  expiry/adjustment; derived (never stored) balance with expiry awareness;
  deterministic earn rule `floor(total/1000)×rate` with 1,000,000-point fraud
  ceiling; config + earn/redeem validation.
- Schema (migration `0026`, additive): `loyalty_accounts` (unique per user),
  `loyalty_ledger_entries` (unique idempotency key), `loyalty_config` (enabled
  defaults false).
- Port/Repo: `ILoyaltyRepository` + Drizzle impl (race-safe account creation,
  conflict-driven idempotent append).
- Use cases: `LoyaltyProgrammeGate` (env flag AND config), Earn (idempotent per
  order `earn:<orderId>`), Redeem (balance check, ≥8-char idempotency key),
  Reverse (admin repair, idempotent per entry, reversals irreversible), History
  (readable while dormant, reports `programmeActive:false`), Get/Save config.
- Routes: `/admin/loyalty/config` GET/PUT + `/admin/loyalty/entries/:id/reverse`
  behind `settings.manage`, mutations audited (`LOYALTY_CONFIG_SAVED`,
  `LOYALTY_ENTRY_REVERSED`); customer `GET /account/loyalty` via existing
  customer session middleware.
- Web: `admin/loyalty.astro` gains a "Dormant ledger configuration" section wired
  to the real config API, displaying programme state (env flag × config switch);
  all existing guardrail/readiness content preserved; customer `loyalty.astro`
  untouched.
- Tests: `Slice08LoyaltyLedger.test.ts` (9) — balance/expiry math, deterministic
  earn + ceiling + zero-rate, config/redeem validation, dormant gating (both
  gates), idempotent earn, overdraw rejection, idempotent reversal +
  reversal-of-reversal rejection, dormant-readable history.

## Deployment

Source-only; migration `0026` and any commercial activation are operator-approval-gated.
