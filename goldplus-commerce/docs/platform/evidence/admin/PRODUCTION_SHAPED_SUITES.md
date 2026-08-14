# Production-Shaped PostgreSQL Suites (§34)

The 41 integration suites had never executed in this programme — they skip
silently without a real database, and local Docker is down. They were run on
the production host against real PostgreSQL 16, isolated from live data.

```
INTEGRATION_FILES=39   TESTS=185   PASSED=185   FAILED=0   SKIPPED=0
```

`ZeroSkipGate` passed, which is the claim that matters: a run that skips is a
run reporting green minus the coverage that matters.

## The first attempt was wrong, and the way it was wrong is the finding

The first run reported **48 failures across 13 files**, all of the shape
"wrote a row, read nothing back". None were defects. I had built the
environment by hand and got three things wrong that `scripts/integration-env.sh`
already encodes:

1. **`DATABASE_URL` and `COMMERCE_TEST_DATABASE_URL` must be the SAME
   database.** I pointed them at two. Suites wrote through one connection and
   read through the other, so every assertion saw an empty table.
2. **The schema must come from a production snapshot, not the migration
   chain.** The harness header states it plainly: building from the migration
   files yields an `orders` table with 8 columns where production has 36. The
   chain cannot reproduce the schema it supposedly built.
3. **The suites must run serially.** They share one database and several
   assert global aggregates; parallel workers race each other's writes and
   produce different failures every run while each suite passes alone.

Rebuilt to that contract — `pg_dump --schema-only` from live (333 tables) into
`gp_shape_commerce` and `gp_shape_auth`, an empty `gp_shape_analytics` because
its suites self-provision and drop tables, then the ten recommendation-programme
migrations, giving `orders` 37 columns — all 185 passed.

The lesson is not "read the script first", though that is true. It is that a
failing integration suite is more often a lie about the environment than a
defect in the code, and 48 failures that all say "the data is not there" are
one failure wearing 48 hats.

## Schema drift: 9 orphaned tables in production

Building a database from the migration chain and diffing it against live
surfaced nine tables that exist in production but that **no migration and no
runtime code creates**:

```
auth_identity_links                    auth_oauth_states
auth_provider_configs                  auth_signin_tokens
auth_signup_risk_events                cdp_event_ledger
commerce_os_records                    external_delivery_readiness_records
measurement_destination_credentials
```

Every one is **empty (0 rows)** and referenced by **zero source files** across
`apps/` and `packages/`. They are dead schema left by a removed feature line.
`measurement_destination_credentials` is the one worth naming explicitly, since
its name suggests stored secrets: it holds nothing.

They were **not dropped**. They are inert, dropping production tables is
irreversible, and nothing in this programme requires it. Recorded here so the
next person who diffs the schema finds an answer instead of a mystery.

This drift is consistent with what the harness already documents — the
migration chain does not reproduce production's schema — and is the reason the
suites target a production snapshot.

## Migration rehearsal

Full sequence, on a restored copy of live data rather than live:

```
backup    pg_dump goldplus -> 188 MB   (pre-cb4024a5-20260814T072435Z.sql)
restore   -> gp_rehearse, 0 errors, 333 tables
migrate   RC migrations on gp_rehearse -> "Migrations complete!"
diff      tables added 0, tables dropped 0
```

Zero, because the release changes **no migration at all**:
`git diff --name-only 68c3ce75..cb4024a5 -- '*migrations*'` is empty. The
release is code-only. The rehearsal was still run, because the cheap way to
learn a release needs no migration is to prove it, not to assume it.

The migration chain was also proven to apply from **zero** on an empty
database — all 125 files, four times over, ending "Migrations complete!".
