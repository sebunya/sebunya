# Surveys source acceptance

Date: 2026-07-20

Base: `d610a935b6dc347c9096ec6a7d3f8ddb4ea1453f`

Source commit: `d5cdec7c58e2c470beeb7fee37545d2a2ddf58b6`

Status: `SOURCE_COMPLETE_NOT_DEPLOYED`.

## Boundary

- Additive migration `0045` creates governed survey definitions, immutable versions, PII-minimized responses and immutable governance events. Earlier migrations are unchanged.
- Questions support bounded scale and enumerated choices only. Contact-data wording, free-text capture, unknown answers and invented options fail closed.
- Lifecycle is `DRAFT→PENDING_APPROVAL→APPROVED→ACTIVE`, with independent approval plus explicit pause/close. Read, create, manage, approve, activate and export permissions are distinct.
- Eligibility reads current personalization consent and Customer DNA lifecycle audience. No consent state is created or mutated.
- Participant ownership uses a one-way SHA-256 reference. Start is idempotent, save and completion enforce ownership/version, and completion rechecks consent, audience and active version.
- Protected administrator and authenticated customer surfaces use real APIs. Analysis is deterministic and export excludes participant references. No invitation, provider, outbox, Automation or communication path exists.

## Proof

- Real PostgreSQL verdict: self-approval denied; no-consent customer excluded; eligible audience included; ownership and invalid answers denied; idempotent start; one concurrent completion winner; questions/audience native JSONB; one completed response; participant reference absent from export; five governance events; consent/preference/outbox/notification/order/payment deltas 0; provider calls 0; residue 0.
- Fresh migration replay: 46 rows, four Survey tables, zero definitions/responses.
- Focused Survey/API/admin-route/architecture: 54/54 PASS.
- Workspace typecheck and API/Astro build PASS; secret scan PASS across 1,204 files; changed-path lint zero errors; `git diff --check` PASS.
- Repository-wide lint: `PRE-EXISTING UNRELATED BASELINE ERROR` at `ICustomerDnaRepository.ts:6`.
- Clean source full suite: 206 files / 4,075 tests PASS.

## Classification guard

Local evidence is not production evidence. This slice performs no production migration/deployment, live survey activation or response, consent/preference mutation, identity provisioning, provider transport, customer communication or `LIVE_VERIFIED` claim.
