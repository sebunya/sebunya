# PIM Import source acceptance

Date: 2026-07-20

Base: `8b9eb1f`

Source commit: `ab156aea207d281380f018ddfcb15e464bc893fc`

Status: `SOURCE_COMPLETE_NOT_DEPLOYED`.

## Review gate and boundary

- Reconciliation found direct single-product catalogue administration but no governed import bounded context.
- The implementation is additive: migration `0044`, PIM domain/port/use case/repository, protected administrator API/UI, six exact permissions, tests and a self-cleaning PostgreSQL proof.
- Canonical source rows are immutable and verified against a recomputed SHA-256. All eight supported catalogue fields require an explicit distinct mapping.
- Preview persists normalized rows, validation evidence, actions, a deterministic digest and complete update snapshots without writing catalogue products.
- Creator self-approval is denied. Apply and rollback require separate privileges. Apply revalidates category, SKU, slug and full snapshot before every write; concurrent drift fails that row without overwrite.
- New products are hidden, zero-stock drafts. Inventory, attributes, images, activation and approval cannot be imported or fabricated.

## Proof

- Focused PIM domain/API/admin-route tests: 40/40 PASS. Architecture: 10/10 PASS.
- Real PostgreSQL: digest tamper denied; three valid and one invalid row; preview product delta zero; creator self-approval denied; two rows applied and one concurrent slug conflict safely failed; exact rollback restored the update and removed the draft.
- Immutable audit: seven PIM events across ingestion, mapping, preview, approval, apply start/completion and rollback.
- Safety deltas: inventory 0, orders 0, payments 0, outbox 0, notifications 0, attributes 0, images 0, provider calls 0, proof residue 0.
- Fresh migration replay: 45 migration rows, four PIM tables, three required foreign keys, zero sessions.
- Workspace typecheck PASS; API/Astro build PASS; secret scan PASS across 1,186 source/config files; changed-path lint has zero errors; `git diff --check` PASS.
- Repository-wide lint: `PRE-EXISTING UNRELATED BASELINE ERROR` at `ICustomerDnaRepository.ts:6`.
- Clean source commit full suite: 202 files / 4,061 tests PASS.

## Classification guard

Local evidence is not production evidence. This slice performs no deployment, production migration, live catalogue import, Inventory mutation, order/payment mutation, provider transport, customer communication or `LIVE_VERIFIED` claim.
