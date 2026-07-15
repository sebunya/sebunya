# Slice 9 — Consent-bound lifecycle segments + deterministic NBA

Date: 2026-07-15 · Branch: `phase-2-measurement-control-tower-completion`

- The "unified profile" IS the existing identity + orders + consent data — no second
  profile store was created (pure read composition).
- Pure domain `domain/identity/CustomerLifecycle.ts`: stages prospect/new/active/
  at_risk/dormant derived only from real order history with published thresholds
  (new ≤60d single order, active ≤90d, at_risk ≤180d, dormant beyond) — every stage
  carries its explanation. Deterministic stage→action map produces operator REVIEW
  suggestions only; nothing sends. Suppression-first: without an explicit
  personalisation-consent grant the action is `suppressed` (unknown counts as no).
- Port/Repo: `ILifecycleReadRepository` — per-registered-customer order aggregates
  (SQL group-by) and personalisation consent resolved from the canonical
  `customer_consent_states` (`purpose_key='personalization'`, unexpired,
  non-superseded; a denial anywhere outweighs a grant; absence = unknown).
- Route: `GET /governance/admin/lifecycle` behind `reports.read`, read-only.
- Web: protected `admin/lifecycle.astro` (sweep 55→56) — stage tiles, suppressed
  count, per-customer stage + explanation + suggestion; masked user ids only,
  no names/contacts/scores; truthful empty/unavailable states.
- Tests: `Slice09LifecycleNba.test.ts` (4) — stage determinism across boundaries
  with explanations, suppression for unknown/denied consent, aggregation +
  no-contact-fields shape, empty state.

No schema change; no migration. Channel activation/lifecycle messaging remains
BLOCKED_EXTERNAL (provider flags off) — this slice is analysis + operator review only.
