# GoldPlus 48-Hour Total Launch War Room — Launch Matrix

Updated: 2026-07-18 · Branch `phase-2-measurement-control-tower-completion`

## Environment truth (Launch Slice L0)

- Worktree: newest clean, remote-aligned; HEAD accepted RC `fabc422` (a documentation-only
  descendant of runtime RC `d3836e8` — `git diff --name-only d3836e8..fabc422` shows only
  `docs/completion/*`, so the runtime image is unchanged and no rebuild is implied).
- `ssh goldplus-prod`: **absent from this container** → production truth capture, migrations,
  image deploy and production UAT are environment-gated (recorded, not performed).
- Docker daemon: **down** → image builds / smokes cannot run here.
- Operator approval markers: none present. Claude never creates them.
- Reported production head (evidence-carried, not re-verified without SSH): `bfa6de6`.

Per the controlling contract, none of the above blocks source implementation, migration
generation, focused/gates verification or release preparation — those proceed here.

## This session's engineering work — Order-to-Admin Fulfilment Alert (P0, Section 9.3)

The launch-critical gap: `/commerce/orders/create` persisted the order but created **no**
actionable admin work item. Implemented as a complete vertical (extend-only, no duplication):

| Layer | Artifact |
|---|---|
| Domain | `apps/api/src/domain/fulfilment/FulfilmentTask.ts` — 9-state lifecycle, pure transition rules, contact masking |
| Port | `apps/api/src/application/ports/IFulfilmentRepository.ts` |
| Use cases | `application/use-cases/fulfilment/{CreateFulfilmentTaskOnOrderPlaced,MarkFulfilmentPaymentConfirmed,TransitionFulfilmentTask,ListFulfilmentQueue,GetFulfilmentOverview}UseCase.ts` |
| Schema | `infrastructure/db/schema/fulfilment.ts` (`fulfilment_tasks`, unique `order_id`) |
| Migration | `infrastructure/db/migrations/0029_bumpy_miss_america.sql` (valid uuid FKs) |
| Repository | `infrastructure/db/repositories/DrizzleFulfilmentRepository.ts` (idempotent `onConflictDoNothing`) |
| Registry | fulfilment repo + 5 use cases wired |
| Routes | `interfaces/http/routes/admin/fulfilment.ts` — GET queue, GET /badge, GET /:id, PATCH /:id/status (orders.read / orders.manage) |
| Hooks | checkout create → task; PesaPal callback + IPN completed → mark ready (idempotent) |
| Web | `apps/web/src/pages/admin/fulfilment/index.astro` + nav "Fulfilment" (working) |
| Tests | `tests/unit/LaunchP1OrderFulfilmentAlert.test.ts` (17) + protection-sweep counts |

### Contract requirements met

- Every placed order creates **one** admin fulfilment task with every ordered product,
  truthful payment status, masked contact, delivery summary, total/fee, warnings, secure id.
- Idempotent by unique `order_id`: duplicate submissions, callbacks and retries never create a
  second alert (proven by test + DB constraint).
- Lifecycle `NEW → ACKNOWLEDGED → PICKING → PACKED → READY_FOR_DISPATCH → OUT_FOR_DELIVERY →
  DELIVERED`, plus `CANCELLED` / `ON_HOLD`; illegal/backward transitions rejected.
- `PaymentConfirmed` updates the existing alert to ready-for-preparation, idempotently, from
  both the callback and IPN paths.
- Internal notification depends on **no external provider** — works when email/SMS/WhatsApp are
  unavailable; a fulfilment failure never fails an already-persisted order.
- Badge = count of `NEW` tasks; the admin "New Orders" queue surfaces NEW first.
- Transitions are audited (`audit_logs`, entity `fulfilment_task`) as the timeline.

## Status ledger (this session's scope)

| Module | Intended function | Reused | Repair/implementation | Prod UAT | Status |
|---|---|---|---|---|---|
| Order → admin fulfilment | Actionable New Orders queue per order | CheckoutUseCase, PesaPal verify, audit_logs, outbox model | Full new vertical (domain→UI) | Gated (no SSH) | SOURCE_COMPLETE_NOT_DEPLOYED |
| Measurement Control Tower | Authenticated readiness summary | 10-E client.unsafe fix | Verified 401/200 at RC previously | Gated | SOURCE_COMPLETE_NOT_DEPLOYED |

Transactional admin email remains provider-gated (recipients must come from secure config, never
hard-coded) and is out of scope for this internal-first commit; the internal task/badge/queue —
the mandatory part — is complete and gated only on deployment.

## Gates at this commit

- security:scan-secrets ✓ · typecheck ✓ · lint ✓ · build ✓
- Full suite: 173 files / 3,821 baseline + 17 new fulfilment tests (the Slice-09 artifact-scope
  guards read the live working tree and are green on the committed/clean tree).
- Architecture: 10/10.
- Migration `0029` generated with valid uuid FKs (fresh replay + rehearsal to be re-run on the
  local Postgres stack).

## Remaining external gates (unchanged, recorded)

`ssh goldplus-prod` access · docker daemon for image build/smoke · operator markers
`/root/APPROVE_GOLDPLUS_DB_BACKUP_AND_MIGRATIONS_0023_0028` and
`/root/APPROVE_GOLDPLUS_API_WEB_DEPLOY_RC1` · provider/customer send activation · legal review ·
commercial loyalty activation · Firefox/WebKit/Lighthouse runs.
