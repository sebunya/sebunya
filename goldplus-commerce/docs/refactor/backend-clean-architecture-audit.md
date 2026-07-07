# Backend Clean Architecture Audit

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, recommendation backend inspected read-only.

## Top 10 Backend Architecture Risks

| Severity | Finding | Evidence | Risk | Recommended fix |
| --- | --- | --- | --- | --- |
| Critical | Unauthenticated governance admin reads | `governance.ts:147`, `governance.ts:385` | Sensitive data exposure. | Auth and permission middleware on every admin read. |
| High | Application layer imports infrastructure | telemetry use cases import db/schema/repositories/logger | Boundary erosion. | Ports for outbox, identity, logging. |
| High | Request ID/tracing middleware after routes | `app.ts:90`, `app.ts:114` | Route handlers may miss correlation context. | Move before routes. |
| High | Metrics route performs broad live dependency work | `metrics.ts:108`, `metrics.ts:136` | Diagnostics can hang. | Timeout/cached metrics collectors. |
| High | Open CORS | `app.ts:41` | Browser access broader than required. | Configure origin allowlist. |
| Medium | Registry is a broad concrete singleton | `Registry.ts` | Hard to test, hidden eager coupling. | Split composition roots by concern. |
| Medium | Route files do too much | `commerce.ts`, `governance.ts`, `admin/products.ts` | Validation/domain orchestration in HTTP layer. | Extract validators/use cases. |
| Medium | Error taxonomy inconsistent | Routes return `INTERNAL_ERROR`, `SERVER_ERROR`, raw messages in some paths. | Hard client handling and possible leakage. | Shared error mapper. |
| Medium | Queue and outbox coupling mixed across repository/use-case layers | Payment repository dynamically imports QueueService. | Infrastructure side effects inside persistence adapter. | Outbox dispatcher boundary. |
| Low | Architecture tests have exemptions | `tests/architecture/boundaries.test.ts` | Fitness functions accept known leaks. | Track and remove exemptions gradually. |

## Architecture Test Result

`pnpm test:architecture` passed:

- `tests/architecture/domain-purity.test.ts`
- `tests/architecture/boundaries.test.ts`

Interpretation: current fitness functions pass. They do not yet fully enforce the intended architecture because exemptions exist.

## Recommended Order

1. Security route protection.
2. Metrics/health isolation.
3. Request ID middleware order.
4. Telemetry ports.
5. Route thinness one group at a time.
6. Tighten architecture tests after implementation.

