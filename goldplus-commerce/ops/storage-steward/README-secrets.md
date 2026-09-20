# Secrets

Everything here lives at `/etc/goldplus/secrets/`, `root:root`, `0600`, on the
server only. This directory in the repository holds **templates with empty
values** so the shape is reviewable; the real files are never committed.

    /etc/goldplus/secrets/object-storage.env
    /etc/goldplus/secrets/restic.env
    /etc/goldplus/secrets/pgbackrest.env

The Storage Steward reads them to act and records only:

    credential_present = true|false
    credential_validation = PASS|FAIL|UNTESTED

It never stores, prints or logs a secret value, and no report or state row
contains one.

## Least privilege

Prefer one credential per purpose, each restricted to its own bucket or prefix:

    pgbackrest      → postgres/
    restic          → restic/
    clickhouse      → clickhouse/
    staging         → peerdb-stage/

A compromised staging key must not be able to delete the database backups.

## Two passphrases that cannot be recovered

`RESTIC_PASSWORD` and `PGBACKREST_REPO1_CIPHER_PASS` encrypt their repositories.
Lose either and the backups it protects are unreadable — by us as well as by
anyone else. Keep a copy somewhere that survives the loss of this machine.
