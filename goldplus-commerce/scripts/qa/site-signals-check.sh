#!/usr/bin/env bash
# Browser check of the site signals (search, new account, shop directions),
# against local services only.
#
#   pnpm build && scripts/integration-env.sh scripts/qa/site-signals-check.sh
#
# Starts the API (from source) and the built web app, then drives real pages in
# Chromium as a shopper's browser would: a search, paging and reloading it, a
# new account, a tap on the map link. Each beacon is recorded with the
# collector's answer, and the queue is read back from the database. Nothing
# leaves the machine: every outbound notification flag is off.
#
# Exit: 0 all checks passed | 1 a check failed | 2 the services did not start
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; S="${BROWSER_CHECK_LOG_DIR:-/tmp/goldplus-browser-check}"; mkdir -p "$S"
API_PORT="${SITE_SIGNALS_API_PORT:-3597}"; WEB_PORT="${SITE_SIGNALS_WEB_PORT:-4397}"
[ -f apps/web/dist/server/entry.mjs ] || { echo "Build the web app first: pnpm build"; exit 2; }
SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
export JWT_SECRET=$SECRET CHECKOUT_INTENT_SECRET=$SECRET CART_CREDENTIAL_SECRET=$SECRET IDENTITY_HASH_PEPPER=$SECRET
export REDIS_URL=redis://127.0.0.1:6379/9
env NODE_ENV=test PORT=$API_PORT PROVIDER_DELIVERY_ENABLED=false CUSTOMER_COMMUNICATIONS_ENABLED=false NOTIFICATION_DELIVERY_ENABLED=false NOTIFICATIONS_LIVE_SEND_ENABLED=false \
  CORS_ORIGINS=http://127.0.0.1:$WEB_PORT npx tsx apps/api/src/interfaces/http/server.ts > $S/ss-api.log 2>&1 &
API_PID=$!
env NODE_ENV=production HOST=127.0.0.1 PORT=$WEB_PORT INTERNAL_API_ORIGIN=http://127.0.0.1:$API_PORT PUBLIC_API_BASE_URL=http://127.0.0.1:$API_PORT \
  PUBLIC_SITE_ORIGINS=http://127.0.0.1:$WEB_PORT node apps/web/dist/server/entry.mjs > $S/ss-web.log 2>&1 &
WEB_PID=$!
trap 'pkill -P $API_PID 2>/dev/null; kill $API_PID $WEB_PID 2>/dev/null' EXIT
for _ in $(seq 1 120); do curl -fsS http://127.0.0.1:$API_PORT/health/live >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS http://127.0.0.1:$API_PORT/health/live >/dev/null 2>&1 || { echo "API did not start"; tail -30 $S/ss-api.log; exit 2; }
for _ in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:$WEB_PORT/login && break; sleep 0.5; done
WEB=http://127.0.0.1:$WEB_PORT API=http://127.0.0.1:$API_PORT node "$HERE/site-signals-check.mjs"; CODE=$?
echo "--- what the collector queued (event name, count)"
psql -tA "$DATABASE_URL" -c "select coalesce(payload->>'event_name', (payload #>> '{}')::jsonb->>'event_name') as event, count(*) from outbox_events where created_at > now() - interval '5 minutes' and coalesce(payload->>'event_name', (payload #>> '{}')::jsonb->>'event_name') in ('search','sign_up','find_location') group by 1 order by 1" 2>&1 | head
[ $CODE -ne 0 ] && { echo "--- api log tail"; tail -15 $S/ss-api.log | cut -c1-300; echo "--- web log tail"; tail -10 $S/ss-web.log | cut -c1-300; }
exit $CODE
