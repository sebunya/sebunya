#!/usr/bin/env bash
# Browser check of the admin and account pages, against local services only.
#
#   pnpm build && scripts/integration-env.sh scripts/qa/admin-browser-check.sh
#
# integration-env.sh rebuilds the local test database and exports DATABASE_URL.
# This script then creates a throwaway admin, starts the API (from source) and
# the built web app on their own ports, and drives real pages in Chromium:
# change password, STOP intake and lift, tier threshold input, the finance
# export, and a render pass over the admin pages. Nothing leaves the machine:
# every outbound notification flag is off.
#
# Exit: 0 all checks passed | 1 a check failed | 2 the services did not start
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; S="${BROWSER_CHECK_LOG_DIR:-/tmp/goldplus-browser-check}"; mkdir -p "$S"
API_PORT="${BROWSER_CHECK_API_PORT:-3598}"; WEB_PORT="${BROWSER_CHECK_WEB_PORT:-4398}"
[ -f apps/web/dist/server/entry.mjs ] || { echo "Build the web app first: pnpm build"; exit 2; }
SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
export JWT_SECRET=$SECRET CHECKOUT_INTENT_SECRET=$SECRET CART_CREDENTIAL_SECRET=$SECRET IDENTITY_HASH_PEPPER=$SECRET
export REDIS_URL=redis://127.0.0.1:6379
export BOOTSTRAP_ADMIN_EMAIL=browser-check@goldplus.test BOOTSTRAP_ADMIN_PASSWORD='Initial-Password-1'
NODE_ENV=test npx tsx scripts/bootstrap-admin.ts > $S/bc-bootstrap.log 2>&1 || { tail -20 $S/bc-bootstrap.log; exit 2; }
psql -q "$DATABASE_URL" -c "insert into loyalty_tiers (code, name, threshold_lifetime_points, rank, active) values ('silver', 'Silver', 5000, 1, false) on conflict do nothing" >/dev/null
env NODE_ENV=test PORT=$API_PORT CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED=true \
  PROVIDER_DELIVERY_ENABLED=false CUSTOMER_COMMUNICATIONS_ENABLED=false NOTIFICATION_DELIVERY_ENABLED=false NOTIFICATIONS_LIVE_SEND_ENABLED=false \
  npx tsx apps/api/src/interfaces/http/server.ts > $S/bc-api.log 2>&1 &
API_PID=$!
env NODE_ENV=production HOST=127.0.0.1 PORT=$WEB_PORT INTERNAL_API_ORIGIN=http://127.0.0.1:$API_PORT PUBLIC_API_BASE_URL=http://127.0.0.1:$API_PORT \
  PUBLIC_SITE_ORIGINS=http://127.0.0.1:$WEB_PORT node apps/web/dist/server/entry.mjs > $S/bc-web.log 2>&1 &
WEB_PID=$!
trap 'pkill -P $API_PID 2>/dev/null; kill $API_PID $WEB_PID 2>/dev/null' EXIT
for _ in $(seq 1 120); do curl -fsS http://127.0.0.1:$API_PORT/health/live >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS http://127.0.0.1:$API_PORT/health/live >/dev/null 2>&1 || { echo "API did not start"; tail -30 $S/bc-api.log; exit 2; }
for _ in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:$WEB_PORT/login && break; sleep 0.5; done
WEB=http://127.0.0.1:$WEB_PORT node "$HERE/admin-browser-check.mjs"; CODE=$?
[ $CODE -ne 0 ] && { echo "--- api log tail"; tail -25 $S/bc-api.log | cut -c1-300; echo "--- web log tail"; tail -15 $S/bc-web.log | cut -c1-300; }
exit $CODE
