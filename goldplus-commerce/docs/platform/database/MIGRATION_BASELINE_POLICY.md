# Migration baseline policy

## Why this exists

A virgin `0000 → 0049` replay **cannot complete**. It fails in
`0018_real_prism.sql` on four foreign keys:

```
release_decisions_recorded_by_users_id_fk
release_readiness_audit_log_admin_user_id_users_id_fk
release_readiness_gate_results_acknowledged_by_users_id_fk
release_readiness_runs_triggered_by_users_id_fk
```

Each declares a `varchar(36)` column referencing `users.id`, which has been `uuid`
since `0000`. The surrounding `DO $$ … EXCEPTION WHEN duplicate_object` blocks catch
only `duplicate_object`, so `datatype_mismatch` propagates.

`0018` is already published and is **not edited**. A later `0050` cannot repair it
either, because the replay stops long before `0050` is reached.

## The model

| Situation | Authority |
|---|---|
| **Existing installations** | Incremental migrations remain authoritative. Nothing changes. |
| **Fresh installations** | Apply the generated baseline at the current ceiling, then any later migrations. |
| **Release rehearsal** | Restore a production-shaped backup at its real ceiling, then apply only pending migrations. |

The baseline is a provisioning convenience for empty databases. It is **never**
applied to a database that holds data, and it never replaces the rehearsal.

## Artefacts

```
apps/api/src/infrastructure/db/baselines/0049_schema.sql
apps/api/src/infrastructure/db/baselines/0049_schema.sha256
apps/api/src/infrastructure/db/baselines/0049_schema.skipped.log
scripts/db/create-schema-baseline.sh
scripts/db/verify-schema-baseline.sh
```

The baseline is **generated, never hand-written**: it is dumped from a database
built by applying the tracked migration chain, so it cannot drift from the
migrations by transcription error.

The generator tolerates only the four known historical statements above. The
allowlist is **closed and exact** — any other failing statement aborts generation
with `UNEXPECTED_MIGRATION_FAILURE` rather than producing a quietly incomplete
schema. Every skipped statement is written to `0049_schema.skipped.log`.

## Proofs

`scripts/db/verify-schema-baseline.sh 0049` proves, against a real PostgreSQL 16:

- the baseline file matches its recorded SHA-256, so a hand-edited baseline is
  refused rather than trusted;
- a fresh database built from the baseline alone reaches the expected schema
  (**175 tables**);
- a database built by the migration chain reaches the same schema;
- the two are **structurally identical**.

Two normalisations make that comparison fair, and neither hides real drift:

1. **Migration bookkeeping** (`__drizzle_migrations`) and the `pg_dump`
   `\restrict` nonce are excluded. The nonce is random per invocation — left in, it
   also made the baseline checksum non-reproducible.
2. **Both sides pass through one identical dump → load → dump cycle.** PostgreSQL
   re-renders semantically identical expressions differently depending on whether
   they were created inline or re-parsed from a dump: an inline
   `x = ANY (ARRAY['A'::varchar])` returns as `ANY ((ARRAY[…])::text[])`. The fresh
   database is built *from* a dump and the upgraded one from DDL, so without a
   symmetric cycle that rendering difference reads as drift. This normalises
   rendering only — a genuine schema difference still survives it.

Regenerating the baseline twice produces an identical checksum.

## What this does not do

- It does not repair the historical chain. The `0000 → 0018` defect remains real and
  is documented here as a historical-chain defect.
- It does not weaken production migration rehearsal. Production still restores a
  real backup at its real ceiling and applies only pending migrations.
- It discards no production data.
