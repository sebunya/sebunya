# GoldPlus Storage Steward

> Optimise for *how little new physical storage we must consume to preserve
> every new piece of information that matters* — not for how many old files we
> can delete.

A timer-driven process: it starts, reads its SQLite state, measures, acts only
if it must, records what it did, and exits. Nothing stays resident. One run
costs about **0.2 s of CPU** and the whole state file is **60 KB**.

    observe     cheap measurement, delta, anomaly detection   (every 15 min)
    housekeep   bounded reclamation, only when the box is idle (daily, 03:20 EAT)
    deep        integrity + restore verification               (weekly)
    report      the health report on demand
    status      one-line JSON for monitoring

## What it does and does not do

It **orchestrates**; it does not reimplement mature storage engines. Docker's
own accounting reports Docker; Postgres reports its own size, WAL and
replication slots; `pg_restore --list` proves a dump is readable. There is no
hand-rolled deduplication and no parsing of database files.

## What is NOT installed on this host

`pgbackrest`, `restic`, `clickhouse`, `peerdb`, `dagster` are **absent**. The
Steward reports them as absent rather than managing them. A report claiming to
prune ClickHouse on a machine with no ClickHouse would be a lie, and the house
rule is that a disabled integration says "not configured".

This also changes what is worth building next. The design anticipates a 40 GB
database whose full copies dominate the disk; this database is **1.7 GB** and
its compressed dump is ~155 MB. Block-level incremental backup would add a
daemon and a new failure mode to save a fraction of a percent of this disk.
That is why it is deferred, not forgotten — see "Next" below.

## The safety rules, in order

1. If the state database cannot be opened → **observation only**, nothing is
   changed.
2. If dependencies or verification cannot be established → **do not delete**.
3. The newest good local recovery point is **never** expired to hit a
   percentage target.
4. Without a *verified remote* repository, local recovery points are not
   expired at all. A copy on the same disk as production is not resilience.
5. Heavy work takes a lease; two heavy jobs never run together on 2 vCPUs.
6. Production outranks maintenance: every unit runs `Nice=19`,
   `IOSchedulingClass=idle`, `CPUWeight=10`.

## Pressure is size *and* velocity

A disk at 41% gaining 8 GB/day is a worse problem than one at 60% that is flat,
so growth escalates the level on its own and the report gives days-to-boundary.

## The numbers that matter

* **Change attribution** — who produced the growth, per resource, over 24 h.
  An unexplained 8 GB is the thing to fear.
* **Storage amplification** — physical bytes stored per logical byte changed.
  0.8× is deduplication earning its keep; 100× means something is copying
  instead of referencing.

## Next, in order of value for THIS host

1. **A verified remote repository.** Every recovery point currently lives on the
   same disk as production. Until that exists, rule 4 keeps all 26 local dumps,
   which is correct but costs 2.5 GB.
2. **Restic** for the media volume and anything not reproducible from git.
3. **pgBackRest** only if the database grows enough to justify it, or if PITR
   becomes a business requirement (`archive_mode` is currently `off`, so the
   recovery point is the last nightly dump).
