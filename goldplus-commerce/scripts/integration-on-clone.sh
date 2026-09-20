#!/usr/bin/env bash
# Integration tests against a DISPOSABLE clone of production. Runs ON the host.
#
#   ./scripts/integration-on-clone.sh <builder-image> <src-dir> <test file>...
#
# Restores the newest backup into a throwaway postgres on a private network,
# applies every migration (the image's), runs the named vitest files with the
# repository's tests mounted, and destroys the clone and its volume. Never
# touches the live database; providers are stubbed inside the tests.
# The root vitest.config.ts is mounted too: without its aliases any test that
# imports @goldplus/shared could never load here (three files silently never ran).
set -euo pipefail
IMG="$1"; SRC="$2"; shift 2
STAMP=$(date +%Y%m%d-%H%M%S); NET=itest-$STAMP; DB=itest-db-$STAMP
cleanup() { docker rm -f -v "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
DUMP=$(ls -t /root/goldplus-db-backups/*.dump | head -1)
echo "clone source: $DUMP"
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_USER=itest -e POSTGRES_PASSWORD=itest -e POSTGRES_DB=goldplus postgres:16-alpine >/dev/null
ready() { docker exec -e PGPASSWORD=itest "$DB" psql -h 127.0.0.1 -U itest -d goldplus -tAc 'select 1' >/dev/null 2>&1; }
ok=0; for i in $(seq 1 90); do if ready; then ok=$((ok+1)); [ $ok -ge 2 ] && break; else ok=0; fi; sleep 2; done
[ $ok -ge 2 ] || { echo "STOP: clone never ready"; exit 1; }
docker cp "$DUMP" "$DB":/tmp/prod.dump
docker exec -e PGPASSWORD=itest "$DB" sh -c 'pg_restore -h 127.0.0.1 -U itest -d goldplus --no-owner --no-privileges /tmp/prod.dump' >/dev/null 2>&1 || true
URL=postgres://itest:itest@$DB:5432/goldplus
COMMON=(--network "$NET" -e DATABASE_URL="$URL" -e COMMERCE_TEST_DATABASE_URL="$URL"
  -e JWT_SECRET="$(openssl rand -hex 32)" -e IDENTITY_HASH_PEPPER="$(openssl rand -hex 24)"
  -e MTN_WEBHOOK_SECRET="$(openssl rand -hex 16)" -e AIRTEL_WEBHOOK_SECRET="$(openssl rand -hex 16)"
  -e PUBLIC_API_BASE_URL=http://itest:3000 -e PROXY_TOPOLOGY_MODE=DIRECT
  -e GA4_MEASUREMENT_ID=G-ITEST00001 -e METRICS_INTERNAL_URL=http://127.0.0.1:9)
docker run --rm "${COMMON[@]}" -e NODE_ENV=production "$IMG" pnpm -F @goldplus/api db:migrate > /tmp/itest-migrate.log 2>&1 || { echo "STOP: migrate failed"; tail -15 /tmp/itest-migrate.log; exit 1; }
echo "clone migrated"
docker run --rm "${COMMON[@]}" -e NODE_ENV=test -v "$SRC/tests:/app/tests:ro" -v "$SRC/vitest.config.ts:/app/vitest.config.ts:ro" "$IMG" sh -c "cd /app && pnpm exec vitest run $*"
