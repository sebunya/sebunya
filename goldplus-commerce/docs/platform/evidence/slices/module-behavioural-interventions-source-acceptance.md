# Behavioral Interventions source acceptance

Date: 2026-07-20

Base: `fc3aa1e00093a38b3bbc921b006a61942445e2c7`

Source commit: `42a3aa1ff82933eec4bab662aea789e3a505d6f3`

Status: `SOURCE_COMPLETE_NOT_DEPLOYED`.

## Boundary

- Additive migration `0046` creates governed definitions, immutable versions, durable intervention exposures/outcomes and immutable governance events. Migrations `0000`–`0045` are unchanged.
- Only truthful, dismissible `ON_SITE` guidance is supported. External channels, transactional CTA paths, urgency, false scarcity, coercion and unsupported claims fail closed; there is no provider, outbox, Automation or customer-communication path.
- Each version is linked to a real Experiment, immutable hypothesis, primary metric and treatment variant. Eligibility deterministically excludes the control variant and requires a running Experiment, current personalization consent and matching Customer DNA lifecycle audience.
- Exposure writes recheck consent/audience inside the transaction. One transaction serializes the frequency cap and atomically persists the Experiment assignment/exposure plus intervention exposure. Idempotent retries create no duplicate effect.
- Dismissal and frequency limits suppress future display. Authenticated customer outcomes are limited to engagement/dismissal; target achievement is accepted only through the server-measurement application boundary. Public responses omit consent references, participant hashes and internal hypothesis/metric evidence.
- Exact read/create/manage/approve/activate RBAC protects the administrator API/control room. Four-eyes approval, running-Experiment activation and immutable event evidence govern lifecycle changes.

## Proof

- Real PostgreSQL verdict: dark-pattern denial; four-eyes denial; pre-running activation denial; current-consent recheck denial; treatment eligible/control suppressed; one winner under concurrent cap contention; exactly one Experiment assignment, one Experiment exposure and one intervention exposure; idempotent exposure/outcome retries; ownership denial; dismissal/pause suppression; one engaged, dismissed and server-measured target outcome; native audience/content/suppression JSONB; five governance events; zero consent/preference/outbox/notification/order/payment deltas; provider calls 0; residue 0.
- Fresh migration replay: 47 migration rows, five empty Behavioral Intervention tables, non-null treatment-variant key and zero business rows.
- Focused Behavioral Intervention/API/admin-route/architecture: 61/61 PASS.
- Workspace typecheck, API/Astro build and secret scan (1,229 files) PASS; changed-path lint has zero errors; `git diff --check` PASS.
- Repository-wide lint: `PRE-EXISTING UNRELATED BASELINE ERROR` at `ICustomerDnaRepository.ts:6`.
- Dirty-tree full suite: 4,088 behavioral passes plus 12 expected historical artifact-scope failures. Clean source full suite: 212 files / 4,102 tests PASS.

## Classification guard

Local source and PostgreSQL evidence is not production evidence. This slice performs no production migration/deployment, live intervention activation/exposure/outcome, consent lifecycle, provider transport, customer communication or `LIVE_VERIFIED` claim.
