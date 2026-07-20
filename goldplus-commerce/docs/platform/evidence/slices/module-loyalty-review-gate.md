# Loyalty review gate

Date: 2026-07-20

Verified base: `fbda7f9b06a719b797d625aab17d2538fd7f0746`

Decision: repair the existing dormant ledger in place. Migration `0047` is required to enforce ledger signs, source relationships and one expiry/reversal per source entry at the database boundary. Migrations `0000`–`0046` remain unchanged.

## Reconciled execution path

- Canonical paid-order source: `apps/api/src/interfaces/http/routes/commerce.ts`, `apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase.ts`, `apps/api/src/infrastructure/db/schema/commerce.ts`.
- Ledger domain and mutations: `apps/api/src/domain/loyalty/LoyaltyLedger.ts`, `apps/api/src/application/use-cases/loyalty/LoyaltyUseCases.ts`, `apps/api/src/application/ports/ILoyaltyRepository.ts`.
- Persistence: `apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyRepository.ts`, `apps/api/src/infrastructure/db/schema/loyalty.ts`, `apps/api/src/infrastructure/db/migrations/0026_strong_psynapse.sql`.
- Protected and customer surfaces: `apps/api/src/interfaces/http/routes/admin/loyalty.ts`, `apps/api/src/interfaces/http/routes/account.ts`, `apps/web/src/pages/admin/loyalty.astro`, `apps/web/src/pages/loyalty.astro`.
- Composition and protection: `apps/api/src/infrastructure/Registry.ts`, `apps/api/src/interfaces/http/app.ts`, `packages/shared/src/permissions/index.ts`.
- Existing proofs: `tests/unit/Slice08LoyaltyLedger.test.ts`, `tests/unit/Slice08LoyaltyGamificationFoundation.test.ts`.

## Active defect evidence

- Redemption reads the ledger and appends a debit in separate calls. Two distinct concurrent redemption keys can both observe the same balance and overdraw it.
- Expired earns are removed from computed availability before an expiry event exists. Adding the missing expiry event would then subtract the same points twice, violating the invariant that balances change only through ledger events.
- No expiry operation exists, despite `expiry` being a declared ledger type and expiry being part of the completion contract.
- Generic idempotency collision handling returns the existing row without verifying that account, type, points and source match the retried command.
- Reversal lookup and append are not one transaction, and persistence does not constrain one reversal or one expiry per source entry.
- The paid-order callback does not invoke the dormant, idempotent earn path, so formal activation would still issue no earned points.
- The administrator page can configure the dormant gate but cannot inspect aggregate balances, due expiries or immutable ledger entries.

## Expected change boundary

- Repair balance derivation, transactional redeem/expire/reverse operations, strict idempotency equivalence and database constraints.
- Wire verified paid-order completion to the already dormant dual-gated earn operation using the server-owned order total and customer identity.
- Add a protected read-only operations summary and recent-ledger view to the existing administrator route/page.
- Add migration `0047`, real-PostgreSQL proof, focused domain/API/UI tests and evidence.
- Not expected to change: canonical pricing, checkout totals, payment verification, order snapshots, Inventory, fulfilment, Customer DNA, Experiments, Automation, providers, outbox, notifications, consent, auth foundations or public activation state.
- Impact: HIGH for financial-liability ledger integrity; CRITICAL payment and order assets are integration inputs and retain their authoritative behavior.

## Required proofs

- Dormant dual gate produces zero entries, and duplicate verified-order callbacks produce one earn event only when explicitly enabled in isolated proof.
- Concurrent redemption produces one winning debit and never a negative balance.
- Expiry is explicit, idempotent and does not double-subtract; reversal is atomic and idempotent.
- Idempotency-key payload mismatch fails closed.
- Every computed balance equals the signed ledger sum and no mutable balance column exists.
- Protected operations API/UI, audit for operator reversal/configuration, zero provider/outbox/notification/consent/order/payment mutations and zero proof residue.
- Fresh migration replay through `0047`, focused tests, workspace typecheck/build, secret scan, changed-path lint, full suite and diff check.
