# Fraud Triage source acceptance

Date: 2026-07-20  
Base: `bd86928f110a62ff434da9948e3524b293fc2ad3`  
Status at source commit: acceptance candidate; clean-commit full suite must pass before completion classification.

## Review gate and boundary

- Reconciliation found no existing Fraud bounded context. `botDetection.ts` is telemetry-only and does not decide checkout, orders or payments.
- The implementation is additive: one `0043` migration, Fraud domain/port/use case/repository, protected administrator API/UI, four exact permissions, tests and a self-cleaning PostgreSQL proof.
- No Automation or Experiments source changed. No public route, checkout hook, payment hook, provider adapter, worker, outbox, notification or automatic-decline path was added.
- Signals always open a review case. `ALLOW`, `HOLD` and `DECLINE` require the separately privileged operator decision endpoint, a reason, bounded non-PII evidence and the current optimistic version.

## Proof

- Focused Fraud/domain/API/admin-route/architecture: 45/45 PASS.
- Real PostgreSQL: two concurrent identical signals create one case and one signal; a second unique signal escalates priority and invalidates stale versions; one of two assignment contenders wins; `REVIEW` remains non-final; explicit operator `DECLINE` resolves; resolved state is immutable.
- Immutable domain audit: five events for two signals, assignment, review and final decision.
- Safety deltas: orders 0, order lines 0, payment attempts 0, inventory reservations 0, outbox 0, notifications 0, provider calls 0, proof residue 0.
- Fresh migration replay: 44 migration rows, three Fraud tables, two required foreign keys, zero cases.
- Workspace typecheck PASS; API/Astro build PASS; architecture 5/5 PASS; secret scan PASS across 1,175 source/config files; changed-path lint has zero errors; `git diff --check` PASS.
- Dirty-tree full suite: 4,039 behavioral passes. The remaining historical artifact-scope checks observe intentional uncommitted paths; the three route-census assertions were updated for the two new protected Astro pages and pass focused. A clean-commit full-suite run is required before final classification.

## Classification guard

Local evidence is not production evidence. This slice performs no deployment, production migration, customer decision, checkout/order/payment mutation, provider transport or `LIVE_VERIFIED` claim.
