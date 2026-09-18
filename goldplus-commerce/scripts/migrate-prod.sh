#!/usr/bin/env bash
# Production schema migration, the only way it is done here. Runs ON the host.
#
#   ./scripts/migrate-prod.sh <migrator-image> <label> ["<assert sql returning 1>"]
#
# 1. Backup   — pg_dump of the live database (the real rollback net).
# 2. Rehearse — restore that dump into a throwaway postgres on a private
#               network, run the migrator against it TWICE (the second run
#               proves idempotency), run the assertion, tear it down.
# 3. Live     — only then run the migrator against production and re-assert.
# Every step halts the script on failure. Nothing here touches the live
# database before the rehearsal has passed.
set -euo pipefail
MIG="${1:?migrator image (built with --target builder)}"; LABEL="${2:?label for the backup, e.g. 0128-feed}"; ASSERT="${3:-select 1}"
cd /opt/goldplus/app/goldplus-commerce
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /root/goldplus-db-backups
DUMP=/root/goldplus-db-backups/goldplus-prod-pre-$LABEL-$STAMP.dump
NET=rehearse-$STAMP; DB=rehearse-db-$STAMP
migrate_against() { # <network> <database url> [--env-file]
  docker run --rm --network "$1" ${3:-} -e DATABASE_URL="$2" -e NODE_ENV=production \
    -e JWT_SECRET="$(openssl rand -hex 32)" -e IDENTITY_HASH_PEPPER="$(openssl rand -hex 24)" \
    -e MTN_WEBHOOK_SECRET="$(openssl rand -hex 16)" -e AIRTEL_WEBHOOK_SECRET="$(openssl rand -hex 16)" \
    -e PUBLIC_API_BASE_URL=http://rehearsal:3000 -e PROXY_TOPOLOGY_MODE=DIRECT \
    "$MIG" pnpm -F @goldplus/api db:migrate
}
cleanup() { docker rm -f "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "=== 1. BACKUP → $DUMP"
docker exec goldplus-commerce-postgres-1 sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc' > "$DUMP"
[ -s "$DUMP" ] || { echo "STOP: empty dump"; exit 1; }
ls -l "$DUMP" | awk '{print "backup bytes", $5}'

echo "=== 2. REHEARSAL on an ephemeral clone"
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_USER=rehearse -e POSTGRES_PASSWORD=rehearse -e POSTGRES_DB=goldplus postgres:16-alpine >/dev/null
# Wait for the REAL server. The image's first "ready" is the temporary
# initdb server (unix socket only), which then shuts down and restarts; a
# check over TCP only passes against the final server. Required twice in a
# row so a server mid-restart is not mistaken for a ready one (2026-09-18:
# the migrator hit "not yet accepting connections" and the rehearsal failed).
ready() { docker exec "$DB" psql -h 127.0.0.1 -U rehearse -d goldplus -tAc 'select 1' >/dev/null 2>&1; }
wait_ready() {
  local ok=0
  for i in $(seq 1 90); do
    if ready; then ok=$((ok+1)); [ "$ok" -ge 2 ] && return 0; else ok=0; fi
    sleep 2
  done
  echo "STOP: rehearsal database never became ready"; exit 1
}
wait_ready
docker cp "$DUMP" "$DB":/tmp/prod.dump
# pg_restore exits non-zero on harmless ownership/extension warnings, so its
# status is not trusted either way: the restored copy is CHECKED instead. A
# rehearsal against a half-empty clone would prove nothing.
docker exec "$DB" sh -c 'pg_restore -h 127.0.0.1 -U rehearse -d goldplus --no-owner --no-privileges /tmp/prod.dump' > /tmp/migrate-restore.log 2>&1 || true
LIVE_TABLES=$(docker exec goldplus-commerce-postgres-1 sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \"select count(*) from information_schema.tables where table_schema='public'\"" | tr -d '[:space:]')
CLONE_TABLES=$(docker exec "$DB" psql -h 127.0.0.1 -U rehearse -d goldplus -tAc "select count(*) from information_schema.tables where table_schema='public'" | tr -d '[:space:]')
[ -n "$LIVE_TABLES" ] && [ "$CLONE_TABLES" = "$LIVE_TABLES" ] || { echo "STOP: restore incomplete — clone has '$CLONE_TABLES' tables, live has '$LIVE_TABLES'"; tail -5 /tmp/migrate-restore.log; exit 1; }
echo "restored clone: $CLONE_TABLES tables (matches live)"
wait_ready
URL=postgres://rehearse:rehearse@$DB:5432/goldplus
migrate_against "$NET" "$URL" > /tmp/migrate-rehearsal-1.log 2>&1 || { echo "STOP: rehearsal run 1 failed"; tail -20 /tmp/migrate-rehearsal-1.log; exit 1; }
migrate_against "$NET" "$URL" > /tmp/migrate-rehearsal-2.log 2>&1 || { echo "STOP: rehearsal run 2 (idempotency) failed"; tail -20 /tmp/migrate-rehearsal-2.log; exit 1; }
R=$(docker exec "$DB" psql -h 127.0.0.1 -U rehearse -d goldplus -tAc "$ASSERT" | tr -d '[:space:]')
[ "$R" = "1" ] || { echo "STOP: rehearsal assertion returned '$R', expected 1"; exit 1; }
echo "REHEARSE_OK (two runs, assertion 1)"
cleanup

echo "=== 3. LIVE"
migrate_against goldplus-commerce_default "$(grep -E '^DATABASE_URL=' .env.production | cut -d= -f2-)" "--env-file .env.production" > /tmp/migrate-live.log 2>&1 || { echo "STOP: live migration failed — restore from $DUMP"; tail -20 /tmp/migrate-live.log; exit 1; }
R=$(docker exec goldplus-commerce-postgres-1 sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \"$ASSERT\"" | tr -d '[:space:]')
[ "$R" = "1" ] || { echo "STOP: live assertion returned '$R' — restore from $DUMP"; exit 1; }
echo "MIGRATED live, assertion 1, backup $DUMP"
