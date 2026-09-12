#!/usr/bin/env bash
# Nightly logical backup of the production database. Runs ON the host.
#
# Why this exists (audit, 2026-09-12): the only backups on the host were the
# pre-migration dumps migrate-prod.sh takes. The newest was 254 hours old. On
# one host with one Postgres container that is an unbounded data-loss window
# between migrations. This is the minimum: a nightly pg_dump kept for 14 days.
# It is NOT off-host; copying the newest dump elsewhere is the next step.
set -euo pipefail
DIR=/root/goldplus-db-backups/nightly
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%d-%H%M%SZ)
OUT="$DIR/goldplus-prod-nightly-$STAMP.dump"
docker exec goldplus-commerce-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT"
[ -s "$OUT" ] || { echo "STOP: empty dump $OUT"; rm -f "$OUT"; exit 1; }
# Prove the dump is readable before trusting it.
docker exec -i goldplus-commerce-postgres-1 pg_restore --list > /dev/null < "$OUT"
find "$DIR" -name 'goldplus-prod-nightly-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "OK $OUT $(stat -c %s "$OUT") bytes; $(ls "$DIR" | wc -l) kept"
