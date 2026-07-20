# Loyalty source acceptance

Date: 2026-07-20

Base: `fbda7f9b06a719b797d625aab17d2538fd7f0746`

Source commit: `32e3ef0c24aa2bd06c85c73400b7dd2751507389`

Status: `SOURCE_COMPLETE_NOT_DEPLOYED`.

## Boundary

- Migration `0047` adds database-enforced entry type/sign/source shape, a self-reference, order lookup and one-expiry/one-reversal-per-source constraints. Migrations `0000`–`0046` are unchanged.
- Available balance is the signed sum of immutable events; time never changes it implicitly. Due points are reported separately and only an explicit expiry event reduces liability. FIFO allocation expires only the unspent remainder of an earn.
- Earn, redeem, expire and reverse are idempotent. PostgreSQL advisory transaction locks serialize each account; concurrent distinct redemption keys cannot both spend the same points. Idempotency-key reuse with different immutable facts fails closed.
- Verified PesaPal completion reads the paid order's persisted user and authoritative total before invoking the existing dual-gated earn use case. The environment gate remains off in shipped configuration, duplicate callbacks converge on one order earn, and no browser price or total is accepted.
- Account history no longer creates an account on read. The existing protected administrator area now exposes PII-minimized account/event/liability/expiry aggregates and recent immutable events. Configuration, expiry and reversal remain explicit permission-protected commands; operator expiry/reversal retains audit evidence.
- The programme remains commercially dormant. This source slice does not activate points, rewards, coupons, promotions, providers or customer communications.

## Proof

- Real PostgreSQL verdict: dormant gate denied with zero entries; duplicate paid-order earn converged; two concurrent 80-point redemptions against 100 points produced one winner; reversal replay produced one event; a partially spent 100-point earn expired exactly its 20-point FIFO remainder; expiry replay produced no event; conflicting idempotency payload and invalid redeem sign were denied; read-only history wrote no account; mutable balance columns 0; six proof events reconciled to signed liability 100; provider calls 0; consent/preference/outbox/notification/order/payment deltas 0; residue 0.
- Populated local upgrade through `0047` passed with 48 migration records, three integrity constraints and zero existing Loyalty business rows.
- Fresh `0000`–`0047` replay passed with 48 migration records, three Loyalty tables, three integrity constraints and zero business rows.
- Focused Loyalty domain/API/UI/architecture: 99/99 PASS. Clean source full suite: 214 files / 4,116 tests PASS.
- Workspace typecheck, API/Astro build, secret scan (1,231 files), admin-route/architecture checks, changed-TypeScript lint with zero errors and `git diff --check` PASS.
- Repository-wide lint: `PRE-EXISTING UNRELATED BASELINE ERROR` at `apps/api/src/application/ports/ICustomerDnaRepository.ts:6`. Dirty-tree full suite: 4,101 behavioral passes plus 12 expected historical artifact-scope failures.

## Classification guard

This is local source and PostgreSQL evidence, not production evidence. Migration `0047` was not applied to production; no production deployment, loyalty activation, live earn/redeem/expire/reverse, consent lifecycle, provider transport, customer communication or `LIVE_VERIFIED` claim occurred.
