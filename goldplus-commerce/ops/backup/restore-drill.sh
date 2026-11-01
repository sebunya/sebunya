#!/usr/bin/env bash
# Restore drill: prove the OFFSITE copy can become a working database.
# Runs ON the host, monthly, and whenever an owner wants to know.
#
#   ops/backup/restore-drill.sh            # pull newest nightly dump from the Storage Box, restore, compare
#   ops/backup/restore-drill.sh --local    # same, from the local copy (what migrate-prod.sh already rehearses)
#
# "Readable" (pg_restore --list, the Steward's deep check) is not "restorable".
# This restores into a throwaway postgres on a private network, never touching
# production, and then compares: table count, and row counts of the five
# largest live tables. The dump is up to a day older than live, so a restored
# count may be lower, never higher, and never below DRILL_MIN_RATIO of live.
# Any failure exits non-zero; systemd's OnFailure sends it to the owner.
set -euo pipefail
BACKUPS="${BACKUP_DIR:-/root/goldplus-db-backups}"
TARGET_FILE="${OFFSITE_TARGET_FILE:-$BACKUPS/.offsite-target}"
SSH_KEY="${OFFSITE_SSH_KEY:-/etc/goldplus/secrets/offsite_ed25519}"
SSH_PORT="${OFFSITE_SSH_PORT:-23}"
MIN_RATIO="${DRILL_MIN_RATIO:-0.90}"
RESULT="${DRILL_RESULT:-/var/lib/goldplus-storage-steward/restore-drill.json}"
SOURCE="${1:-offsite}"

STAMP=$(date -u +%Y%m%d-%H%M%S); NET=drill-$STAMP; DB=drill-db-$STAMP; WORK=$(mktemp -d /tmp/restore-drill.XXXXXX)
cleanup() { docker rm -f -v "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "DRILL FAILED: $*"; printf '{"at":"%s","source":"%s","ok":false,"reason":"%s"}\n' "$(date -u +%FT%TZ)" "$SOURCE" "$*" > "$RESULT" 2>/dev/null || true; exit 1; }

echo "=== restore drill $(date -u +%FT%TZ) source=$SOURCE"
if [ "$SOURCE" = "--local" ]; then
  DUMP=$(ls -t "$BACKUPS"/nightly/goldplus-prod-nightly-*.dump 2>/dev/null | head -1 || true)
  [ -n "$DUMP" ] || fail "no local nightly dump"
else
  [ -s "$TARGET_FILE" ] || fail "no offsite target in $TARGET_FILE"
  TARGET="$(head -1 "$TARGET_FILE" | tr -d '[:space:]')"
  E="ssh -p $SSH_PORT -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
  # newest nightly dump BY NAME on the far side (names carry the UTC stamp)
  NEWEST=$(rsync -e "$E" --list-only "$TARGET/nightly/" | awk '/^-/ && $NF ~ /^goldplus-prod-nightly-.*\.dump$/ {print $NF}' | sort | tail -1)
  [ -n "$NEWEST" ] || fail "no nightly dump on $TARGET"
  rsync -e "$E" --timeout=600 "$TARGET/nightly/$NEWEST" "$WORK/" || fail "could not pull $NEWEST from $TARGET"
  DUMP="$WORK/$NEWEST"
fi
echo "dump: $DUMP ($(stat -c %s "$DUMP" 2>/dev/null || stat -f %z "$DUMP") bytes)"

docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=goldplus postgres:16-alpine >/dev/null
ready() { docker exec -e PGPASSWORD=drill "$DB" psql -h 127.0.0.1 -U drill -d goldplus -tAc 'select 1' >/dev/null 2>&1; }
ok=0; for i in $(seq 1 90); do if ready; then ok=$((ok+1)); [ $ok -ge 2 ] && break; else ok=0; fi; sleep 2; done
[ $ok -ge 2 ] || fail "drill database never became ready"
docker cp "$DUMP" "$DB":/tmp/drill.dump
# pg_restore's exit status is noise (ownership/extension warnings); the result is CHECKED.
docker exec -e PGPASSWORD=drill "$DB" sh -c 'pg_restore -h 127.0.0.1 -U drill -d goldplus --no-owner --no-privileges /tmp/drill.dump' > "$WORK/restore.log" 2>&1 || true

live()  { docker exec goldplus-commerce-postgres-1 sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \"$1\""; }
drill() { docker exec -e PGPASSWORD=drill "$DB" psql -h 127.0.0.1 -U drill -d goldplus -tAc "$1"; }
Q_TABLES="select count(*) from information_schema.tables where table_schema='public'"
LT=$(live "$Q_TABLES" | tr -d '[:space:]'); DT=$(drill "$Q_TABLES" | tr -d '[:space:]')
echo "tables: live=$LT restored=$DT"
[ "$DT" = "$LT" ] || fail "table count differs: live $LT, restored $DT"

# the five largest live tables by rows, compared one by one
TABLES=$(live "select relname from pg_stat_user_tables order by n_live_tup desc limit 5" | tr -d ' ' | grep . || true)
[ -n "$TABLES" ] || fail "could not list live tables"
checks=""
for t in $TABLES; do
  L=$(live "select count(*) from \"$t\"" | tr -d '[:space:]'); D=$(drill "select count(*) from \"$t\"" 2>/dev/null | tr -d '[:space:]' || echo "ERR")
  echo "  $t: live=$L restored=$D"
  [ "$D" != "ERR" ] || fail "table $t missing in the restore"
  [ "$D" -le "$L" ] || fail "table $t has MORE rows restored ($D) than live ($L): wrong dump?"
  if [ "$L" -gt 0 ]; then
    awk -v d="$D" -v l="$L" -v r="$MIN_RATIO" 'BEGIN { exit !(d >= l * r) }' || fail "table $t restored $D of $L rows, below the $MIN_RATIO floor"
  fi
  checks="$checks{\"table\":\"$t\",\"live\":$L,\"restored\":$D},"
done
printf '{"at":"%s","source":"%s","ok":true,"dump":"%s","tables":%s,"checks":[%s]}\n' \
  "$(date -u +%FT%TZ)" "$SOURCE" "$(basename "$DUMP")" "$LT" "${checks%,}" > "$RESULT" 2>/dev/null || true
echo "DRILL OK: $(basename "$DUMP") restores to $DT tables; the five largest tables are within $MIN_RATIO of live"
