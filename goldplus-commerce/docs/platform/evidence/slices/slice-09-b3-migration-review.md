# Slice 9-B3 migration review

## Migration

`apps/api/src/infrastructure/db/migrations/0022_low_phil_sheldon.sql` is the single new SQL migration. Drizzle-generated journal/snapshot metadata tracks it. It has not been executed.

## Additive review

| Check | Result |
|---|---|
| New objects only | Passed: four enums, eleven tables, indexes, checks, one append-only trigger function, and three triggers |
| Destructive DDL | Passed: no drop table/column, rename, truncate, backfill, update, or delete statement |
| Existing migration edits | Passed: no historical SQL migration changed |
| Customer-data backfill | None |
| Legacy auto-grant | Structurally impossible: mapping outcome enum excludes `granted` |
| Provider secrets | None; callback references and normalized non-secret evidence only |
| Stable identity/time | UUID primary keys and explicit created/effective/provider timestamps |
| Lookup performance | Purpose/channel version, aggregate consent, state, audit, callback, suppression, support-ticket, legacy-review, and policy-scope indexes |
| PII minimisation | Opaque identity and endpoint references; no message body, provider credential, or raw secret column |
| Audit integrity | Integrity hash or external tamper-evidence reference required |
| Audit immutability | Consent events, provider unsubscribe events, and policy blocks reject update/delete |

## Red-line constraints

- Anonymous identity cannot hold a granted current state.
- Checkout-contact-only identity cannot hold a `marketing_offers_campaigns` grant.
- Support-assisted requests cannot request a direct `granted` state.
- A policy block must identify a customer or cohort scope.
- Provider STOP/unsubscribe has dedicated immutable evidence plus channel-suppression representation.
- Withdrawal and policy-block states are first-class canonical values; later pure precedence guards fail closed.

## Generator boundary

The repository has pre-existing live-canary schema declarations that are absent from migration snapshot history. They were deliberately excluded while generating 0022 so unrelated tables were not smuggled into Slice 9-B3. The final schema registry remains unchanged for those pre-existing declarations. That historical drift should be handled under separately authorized migration reconciliation; it is not corrected here.

## Execution and rollback

Production migration execution: none. Deployment: none. Service restart: none.

Before any future environment execution, specialists must approve identity, audit/tamper evidence, retention, callback authenticity, and ownership. Rollback before execution is removal/revert of this slice. After an authorized non-production execution, rollback should prefer disabling consumers and a separately reviewed forward migration; this slice does not provide destructive down SQL.
