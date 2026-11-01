#!/usr/bin/env bash
# Nightly logical backup of the production database. Runs ON the host.
#
# Why this exists (audit, 2026-09-12): the only backups on the host were the
# pre-migration dumps migrate-prod.sh takes. The newest was 254 hours old. On
# one host with one Postgres container that is an unbounded data-loss window
# between migrations. This is the minimum: a nightly pg_dump.
# Expiry is NOT done here: the Storage Steward is the only pruner, and its
# rule 4 expires no recovery point without a verified offsite copy
# (offsite-sync.sh). A flat age-based delete here bypassed that rule.
#
# Each file is written under a .partial name and renamed only once it is
# proved, so a dump cut short (postgres restart, full disk) never sits in
# nightly/ looking like a recovery point. .partial matches neither the
# offsite sync's patterns nor the Steward's.
set -euo pipefail
DIR="${BACKUP_NIGHTLY_DIR:-/root/goldplus-db-backups/nightly}"
mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%d-%H%M%SZ)
OUT="$DIR/goldplus-prod-nightly-$STAMP.dump"
TMP_OUT="$OUT.partial"
MEDIA_TMP=""
trap 'rm -f "$TMP_OUT" ${MEDIA_TMP:+"$MEDIA_TMP"}' EXIT
docker exec goldplus-commerce-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TMP_OUT"
[ -s "$TMP_OUT" ] || { echo "STOP: empty dump $OUT"; exit 1; }
# Prove the dump is readable before trusting it.
docker exec -i goldplus-commerce-postgres-1 pg_restore --list > /dev/null < "$TMP_OUT"
mv -f "$TMP_OUT" "$OUT"
# The media volume holds every product photo and has never been backed up
# either (7.3 MB on 2026-09-12). A tar of the volume alongside the dump.
MEDIA_VOL="${MEDIA_VOL:-goldplus-commerce_media_uploads}"
MEDIA_OUT="$DIR/goldplus-media-nightly-$STAMP.tar.gz"
MEDIA_TMP="$MEDIA_OUT.partial"
docker run --rm -v "$MEDIA_VOL":/media:ro -v "$DIR":/out alpine:3 sh -c "tar -czf /out/$(basename "$MEDIA_TMP") -C /media ."
[ -s "$MEDIA_TMP" ] || { echo "STOP: empty media archive $MEDIA_OUT"; exit 1; }
tar -tzf "$MEDIA_TMP" > /dev/null
mv -f "$MEDIA_TMP" "$MEDIA_OUT"
echo "OK db=$OUT ($(stat -c %s "$OUT") bytes) media=$MEDIA_OUT ($(stat -c %s "$MEDIA_OUT") bytes); $(ls "$DIR" | wc -l) files kept"
