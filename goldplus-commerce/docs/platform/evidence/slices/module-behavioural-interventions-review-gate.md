# Behavioral Interventions review gate

Date: 2026-07-20

Verified base: `fc3aa1e00093a38b3bbc921b006a61942445e2c7`

Decision: implement one additive, on-site-only bounded context. Migration `0046` is required for governed definitions, immutable versions, durable exposure/outcome measurement and immutable events. Migrations `0000`–`0045` remain unchanged.

## Reconciled execution path

- Experiment governance and deterministic attribution: `apps/api/src/domain/experiments/Experiment.ts`, `apps/api/src/application/use-cases/experiments/ExperimentOperationsUseCase.ts`, `apps/api/src/infrastructure/db/repositories/DrizzleExperimentRepository.ts`, `apps/api/src/infrastructure/db/schema/experiments.ts`.
- Customer audience and suppression inputs: `apps/api/src/domain/customer-dna/NextBestAction.ts`, `apps/api/src/infrastructure/db/schema/customer_dna.ts`, `apps/api/src/infrastructure/db/schema/consent.ts`.
- Measurement conventions: `apps/api/src/application/ports/measurement/MeasurementAdminRepository.ts`, `apps/api/src/infrastructure/db/schema/measurement.ts`, `apps/api/src/interfaces/http/routes/admin/measurement.ts`.
- Native governance/API/UI conventions: `apps/api/src/application/use-cases/surveys/SurveyOperationsUseCase.ts`, `apps/api/src/infrastructure/db/repositories/DrizzleSurveyRepository.ts`, `apps/api/src/interfaces/http/routes/admin/surveys.ts`, `apps/web/src/pages/admin/surveys/index.astro`.
- Shared protection and composition: `packages/shared/src/permissions/index.ts`, `apps/api/src/infrastructure/Registry.ts`, `apps/api/src/interfaces/http/app.ts`, `tests/architecture/boundaries.test.ts`.

## Defect and boundary classification

- No existing Behavioral Interventions bounded context, route, repository, schema or operating page exists. The queue classification `MISSING` is confirmed.
- Existing Experiments, Customer DNA, consent, measurement, audit, Automation and outbox infrastructure must be reused or left untouched; no replacement framework is justified.
- The first complete boundary supports only truthful, dismissible on-site guidance. External channel delivery is `NOT_SUPPORTED`; there is no provider, outbox or customer-communication path.
- Eligibility must fail closed unless the intervention is active, its linked experiment is running, the customer has current personalization consent, its Customer DNA lifecycle matches, the content is ethical and the frequency/dismissal suppression gates pass.
- Every exposure and outcome must be idempotent, tied to the intervention version, deterministic treatment assignment, atomic Experiment exposure and one-way customer reference, and available as persisted aggregate evidence. No browser-provided qualification or experiment attribution is authoritative.

## Expected change boundary

- New Behavioral Interventions domain, application port/use case, Drizzle schema/repository, migration `0046`, protected administrator API/UI, authenticated account API, Registry/app composition, RBAC, proof and focused tests.
- Expected shared changes: schema export, migration journal, exact admin route census.
- Not expected to change: Experiment assignment semantics, Customer DNA/NBA computation, consent write paths, measurement delivery, Automation, outbox, providers, checkout, orders, payments, inventory, fulfilment, auth or audit foundations.
- Impact: HIGH for new governed persistence and customer-facing eligibility; CRITICAL assets are read-only dependencies and remain unmodified.

## Required proofs

- Ethical-content validator, immutable lifecycle, four-eyes approval, active/running-experiment gate, consent/audience exclusion, deterministic suppression, idempotent exposure/outcome and outcome ownership.
- Real PostgreSQL native JSONB, treatment/control separation, atomic Experiment/intervention exposure uniqueness, concurrent frequency-cap safety, measured aggregates, pause suppression, zero provider/outbox/notification/consent/order/payment mutations and zero residue.
- Fresh migration replay through `0046`, focused RBAC/API/UI/architecture tests, workspace typecheck/build, secret scan, changed-path lint, full suite and diff check.
