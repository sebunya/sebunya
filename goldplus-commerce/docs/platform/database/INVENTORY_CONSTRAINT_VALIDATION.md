# Inventory constraint validation

`products_reserved_within_stock` is introduced by migration `0052` as `NOT VALID`.

That is deliberate and it is a **starting** position, not a resting one.

## Why NOT VALID at first

`ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)` without `NOT VALID` scans the
whole table under `ACCESS EXCLUSIVE` and **fails the migration** if any existing
row violates it. A violating row here means real customer orders were promised
against units the business does not hold. That is a commercial problem. A schema
migration is not entitled to settle it by refusing to deploy, and it is not
entitled to settle it by quietly changing the data either.

`NOT VALID` binds every INSERT and UPDATE immediately — no *new* write can strand
a reservation — while leaving the legacy rows visible and unresolved.

## Why it cannot stay that way

While `convalidated = false`, PostgreSQL will not use the constraint for
inference and the invariant is only true of rows written since the migration. The
release gate below must reach `convalidated = true`.

## The gate

    scripts/db/inventory-constraint-readiness.sh [--report-only] [--waiver <file>]

| Exit | Meaning |
|---|---|
| 0 | validated, `convalidated = true` (or already was) |
| 3 | violations remain, not ready |
| 4 | waiver file malformed or lacking evidence |
| 5 | validation attempted and failed |

It reports every violating product with its unbacked quantity, **and** the
customer orders holding those reservations — an operator cannot act on a count.

## What the gate will not do

It never releases a reservation and never raises stock. Both would make
validation pass while destroying the only evidence that something was wrong, and
both are decisions about specific named customer orders. Remediation is:

- cancel or release the affected order, with the customer informed; **or**
- receive stock that genuinely backs the promise.

A waiver records a deferred decision with evidence (`<product-uuid> <reason>`,
one per line). A waiver does **not** make the data consistent: a waived row still
violates, so `VALIDATE CONSTRAINT` still cannot succeed, and the gate says so
rather than reporting a pass it did not achieve.

## Release requirement

Wave 1 is not complete until this gate exits 0 against the production database
and `pg_constraint.convalidated` is `true`.
