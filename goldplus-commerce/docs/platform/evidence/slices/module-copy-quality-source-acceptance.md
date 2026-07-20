# Copy Quality source acceptance

Date: 2026-07-20

Base: `0f464cd6165b2156159578acc424a48369262142`

Source commit: `de05a194a84936aed4028ca86a6dbcfc1ad2480f`

Status: `SOURCE_COMPLETE_NOT_DEPLOYED`.

## Boundary

- Copy Quality is a read-only bounded context over canonical catalogue copy. It introduces no schema or migration and exposes no rewrite, publish, provider or customer-communication path.
- Policy `copy-quality-v1` evaluates required fields, placeholder content, unsupported absolute claims, repeated whitespace or punctuation, explicit length limits and cross-product duplicate copy.
- Every deterministic issue carries a rule, severity, field and explanation. Overall results are `PASS`, `REVIEW` or `BLOCKED`; no subjective score or unsupported grade is produced.
- Catalogue reads require active, approved products and support explicit category, status and issue filtering. Model-assisted review reports `NOT_CONFIGURED` and performs zero provider calls.
- Protected administrator report/export surfaces use distinct `copy_quality.read` and `copy_quality.export` permissions. Export contains only the same canonical, deterministic report data.

## Proof

- Real PostgreSQL verdict: three fixtures scanned; one blocked product; two duplicate products; placeholder and claim rules explained; filters truthful; model status `NOT_CONFIGURED`; provider calls 0; audit/outbox/notification/consent/order/payment deltas 0; residue 0.
- Focused Copy Quality/API/admin-route/architecture: 52/52 PASS.
- Workspace typecheck and API/Astro build PASS; secret scan PASS across 1,215 files; changed-path lint zero errors; `git diff --check` PASS.
- Repository-wide lint: `PRE-EXISTING UNRELATED BASELINE ERROR` at `ICustomerDnaRepository.ts:6`.
- Dirty-tree full suite: 4,072 behavioral passes plus 12 expected historical artifact-scope failures. Clean source full suite: 209 files / 4,084 tests PASS.

## Classification guard

Local source and database evidence is not production evidence. This slice performs no production migration/deployment, catalogue write, copy rewrite, publication, consent mutation, provider transport, customer communication or `LIVE_VERIFIED` claim.
