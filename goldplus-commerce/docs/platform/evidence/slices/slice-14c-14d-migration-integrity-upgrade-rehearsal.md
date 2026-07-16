# Slice 14C + 14D — Migration history integrity restored; production-shaped upgrade proven

Date: 2026-07-16 · Branch: `phase-2-measurement-control-tower-completion`
Environment: local PostgreSQL 16 (throwaway env values; no production access, no PII).

## 14C — 0018 integrity

**Modification history proven, not assumed:**
- Created in `1a45f9b` ("feat: add release readiness manager"); modified only by
  `4bdd642` (Slice 0B). Original bytes sha256
  `69acb44c10ab115cc527cb0aa9fab7c1844e740ab8418d235669ab812f9bba46`.
- Migration runner behaviour (drizzle-orm 0.29.5, read from installed source):
  applies a migration iff `lastDbMigration.created_at < migration.folderMillis`.
  **Hashes are stored but never compared**, so (a) the 0B edit could never have
  re-executed 0018 on an upgraded environment, and (b) no checksum ledger exists
  to invalidate. The four FK statements fail with SQLSTATE 42804 on every fresh
  database, so no environment has ever recorded those constraints — partial
  application is structurally impossible for them (each is an independent DO block).

**Integrity outcome (contract-preferred):**
- `0018_real_prism.sql` restored byte-identical to its original commit
  (hash pinned by regression test `Slice14CMigrationIntegrity.test.ts`).
- Narrow shim in `migrate.ts` + `knownInvalidHistoricalStatements.ts`: during
  bootstrap the runner skips ONLY the four exact (whitespace-normalized)
  historical statements, logs each skip, and everything else executes unchanged.
  Regression tests prove the 0028 repair statements and near-miss statements are
  never matched (no generic suppression). First shim draft over-matched 0028's
  textually identical DO blocks — caught by verification (0 FKs), fixed by making
  0028's statements textually distinct (0028 has never been applied anywhere).

**Proof A — fresh bootstrap 0000→0028:** exactly 4 skips; 115 tables; 29 ledger
rows; `recorded_by` = uuid; all 4 `release_*_users_id_fk` constraints present.
**Proof C — idempotent re-run:** second run performs 0 skips, 0 re-executions;
ledger stays 29.

## 14D — production-shaped upgrade rehearsal (pre-0023 → latest)

Staged a pre-0023 database (23 ledger rows, staged migrations folder) and seeded a
schema-faithful synthetic fixture — users, category/product/prices (retail+dealer),
paid order + items, payment + attempt, support ticket, consent-era tables, and
uuid-strings stored in all four varchar(36) release columns (the cast path).
No production data or PII was used.

| Rehearsal evidence | Result |
|---|---|
| Pending migrations applied (0023→0028) | ✔, duration **153 ms**, single transaction per migration (drizzle default; short ACCESS EXCLUSIVE windows on ALTERed tables only) |
| Migration ledger | 23 → 29, no duplicates |
| Row counts | users 2, orders 1, payments 1, release_decisions 1 — unchanged |
| varchar→uuid casts | lossless (`recorded_by` value preserved, type uuid) |
| New FKs | 4 present, `convalidated`, and **enforced** (orphan insert rejected live) |
| Orphan check | 0 |
| New-slice tables | delivery_zones, search_demand_signals, product_compatibility_mappings, loyalty_* all created |
| Existing order row | intact; gains `delivery_fee_confirmed=false`, null `client_order_key` |
| 0018 on upgrade path | untouched (0 skips — timestamp skip proven live) |
| Re-run idempotency | 0 statements, ledger stable |

**Rollback/forward-fix plan:** all six pending migrations are additive except the
0028 type casts; rollback = restore the pre-migration backup (production sequence
already mandates backup-before-migration); forward-fix is preferred since casts
are lossless and validated pre-flight by this rehearsal. If a production
`recorded_by`-family value were ever non-uuid, 0028 would abort atomically inside
its own transaction, leaving prior state — verify with the pre-flight query in
the release runbook (`select ... where recorded_by !~ '^[0-9a-f-]{36}$'`).
