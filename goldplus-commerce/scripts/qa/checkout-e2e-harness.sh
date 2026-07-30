#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS — REAL END-TO-END CHECKOUT HARNESS
#
# WHY THIS EXISTS
# Every checkout defect this programme found was invisible to the tests that
# existed. `pnpm build` passed while the checkout page threw a ReferenceError on
# its first GET. Component tests passed while the API returned `orderId` and the
# page read `res.data.id`, so the payment handoff silently never started. A strong
# set of components is not a completed customer journey, and only a request that
# travels the real path can tell the difference.
#
# So this stands up the ACTUAL path:
#
#   real HTTP client  ->  Astro SSR (the BFF that owns the browser cookie)
#                     ->  server-side fetch  ->  Commerce API (Hono)
#                     ->  real PostgreSQL  +  real Redis
#                     ->  PesaPal stub (local, stateful, no external call)
#
# Nothing here is mocked in-process. The cookie is a real Set-Cookie the client
# stores and replays; the order is a real row; the provider submission is a real
# HTTP request to a stub that counts it.
#
# WHAT IT WILL NOT DO
#   - no external network call, ever: the provider is a local stub
#   - no production credentials: it generates its own throwaway secrets
#   - no real payment: the stub issues no money movement of any kind
#   - it starts and stops ONLY processes it created, on its own ports, and it
#     never touches a shared or production service
#
# Usage:  scripts/qa/checkout-e2e-harness.sh
# Exit:   0 all proofs passed | 1 a proof failed | 2 the harness could not start
# =============================================================================
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$ROOT"

PG_HOST=127.0.0.1
PG_PORT="${E2E_PG_PORT:-5599}"
PG_URL="postgresql://postgres:postgres@${PG_HOST}:${PG_PORT}/gp_e2e"
REDIS_PORT="${E2E_REDIS_PORT:-6399}"
STUB_PORT="${E2E_STUB_PORT:-4599}"
API_PORT="${E2E_API_PORT:-3599}"
WEB_PORT="${E2E_WEB_PORT:-4321}"

LOG_DIR="${E2E_LOG_DIR:-/tmp/goldplus-e2e}"
mkdir -p "$LOG_DIR"

STUB_PID=""
API_PID=""
WEB_PID=""

# Every process this script started is stopped, and only those. A trap rather
# than a tidy-up at the end, so a failed assertion does not leave three servers
# holding ports.
# Kills a process AND its descendants.
#
# Killing the recorded pid alone is not enough: `npx tsx` is a wrapper that spawns
# the real node process, so terminating the wrapper ORPHANS the child, which keeps
# holding the port. That produced a genuinely misleading run — a stale API from a
# previous invocation answered every request, so edits to the source had no effect
# on the results and the harness was quietly testing old code.
kill_tree() {
  local pid="$1" signal="${2:-TERM}"
  [[ -n "$pid" ]] || return 0
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  for child in $children; do kill_tree "$child" "$signal"; done
  kill "-${signal}" "$pid" 2>/dev/null || true
}

cleanup() {
  local code=$?
  for pid in "$WEB_PID" "$API_PID" "$STUB_PID"; do kill_tree "$pid" TERM; done
  # Give them a moment to release the ports before the next run.
  sleep 1
  for pid in "$WEB_PID" "$API_PID" "$STUB_PID"; do kill_tree "$pid" KILL; done
  exit "$code"
}
trap cleanup EXIT INT TERM

# A port already in use means something else — very likely a leaked process from an
# earlier run — would answer these requests. Refusing is the only safe response: a
# harness that silently tests a stale server is worse than no harness, because its
# results look like evidence.
require_free_port() {
  local port="$1" what="$2"
  if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    exec 3<&- 2>/dev/null || true
    die "port ${port} (${what}) is already in use; stop the process holding it first"
  fi
}

say() { printf '\n=== %s\n' "$1"; }
die() { printf 'HARNESS_CANNOT_START: %s\n' "$1" >&2; exit 2; }

# --- Preconditions -----------------------------------------------------------
# Reported as "cannot start" (exit 2), never as a failed proof. A missing
# dependency is not evidence about the checkout.
say 'Checking preconditions'
command -v psql >/dev/null || die 'psql is not available'
command -v node >/dev/null || die 'node is not available'
pg_isready -h "$PG_HOST" -p "$PG_PORT" >/dev/null 2>&1 || die "PostgreSQL is not accepting connections on ${PG_PORT}"

if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  command -v redis-server >/dev/null || die 'redis-server is not available'
  printf 'starting redis on %s\n' "$REDIS_PORT"
  # No persistence: this is a throwaway instance for one run.
  redis-server --port "$REDIS_PORT" --daemonize yes --save '' --appendonly no >/dev/null
  sleep 1
  redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 || die "redis did not come up on ${REDIS_PORT}"
fi
require_free_port "$STUB_PORT" 'PesaPal stub'
require_free_port "$API_PORT" 'Commerce API'
require_free_port "$WEB_PORT" 'storefront'
printf 'postgres %s, redis %s\n' "$PG_PORT" "$REDIS_PORT"

# --- Schema ------------------------------------------------------------------
# Rebuilt from the generated baseline plus every migration above it, so the
# harness runs against the same schema a fresh install gets rather than against
# whatever a previous run left behind.
say 'Provisioning gp_e2e at the migration ceiling'
psql -q "postgresql://postgres:postgres@${PG_HOST}:${PG_PORT}/postgres" \
  -c 'DROP DATABASE IF EXISTS gp_e2e WITH (FORCE);' \
  -c 'CREATE DATABASE gp_e2e;' >/dev/null

BASELINE="$(ls -1 apps/api/src/infrastructure/db/baselines/*_schema.sql | sort | tail -1)"
[[ -f "$BASELINE" ]] || die 'no generated schema baseline found'
psql -v ON_ERROR_STOP=1 -q "$PG_URL" -f "$BASELINE" >/dev/null
printf 'baseline: %s\n' "$(basename "$BASELINE")"

BASELINE_CEILING="$(basename "$BASELINE" | cut -d_ -f1)"
for migration in apps/api/src/infrastructure/db/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  number="$(basename "$migration" | cut -d_ -f1)"
  # Only migrations ABOVE the baseline: the baseline already contains the rest,
  # and replaying the historical chain aborts at 0018.
  [[ "$number" > "$BASELINE_CEILING" ]] || continue
  psql -v ON_ERROR_STOP=1 -q "$PG_URL" -f "$migration" >/dev/null \
    || die "migration failed: $(basename "$migration")"
  printf 'applied %s\n' "$(basename "$migration")"
done

# --- Throwaway secrets -------------------------------------------------------
# Generated per run. No production credential is read, and nothing here is
# written to a file that outlives the run.
E2E_JWT_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
E2E_INTENT_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
E2E_PEPPER="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"

# --- PesaPal stub ------------------------------------------------------------
say 'Starting the PesaPal stub'
node scripts/qa/pesapal-stub.mjs "$STUB_PORT" >"$LOG_DIR/stub.log" 2>&1 &
STUB_PID=$!
for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:${STUB_PORT}/__stub/submissions" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS "http://127.0.0.1:${STUB_PORT}/__stub/submissions" >/dev/null 2>&1 \
  || die "the PesaPal stub did not start (see $LOG_DIR/stub.log)"

# --- Seed --------------------------------------------------------------------
# Seeded through the same Drizzle schema the application uses, so a column the
# harness relies on cannot silently differ from the one the code writes.
say 'Seeding a purchasable product'
DATABASE_URL="$PG_URL" npx tsx scripts/qa/checkout-e2e-seed.ts >"$LOG_DIR/seed.log" 2>&1 \
  || { cat "$LOG_DIR/seed.log"; die 'seeding failed'; }
cat "$LOG_DIR/seed.log"

# --- API ---------------------------------------------------------------------
say 'Starting the Commerce API'
env \
  NODE_ENV=test \
  PORT="$API_PORT" \
  DATABASE_URL="$PG_URL" \
  REDIS_URL="redis://127.0.0.1:${REDIS_PORT}" \
  JWT_SECRET="$E2E_JWT_SECRET" \
  CHECKOUT_INTENT_SECRET="$E2E_INTENT_SECRET" \
  IDENTITY_HASH_PEPPER="$E2E_PEPPER" \
  PESAPAL_ENV=sandbox \
  PESAPAL_BASE_URL="http://127.0.0.1:${STUB_PORT}" \
  PESAPAL_CONSUMER_KEY=stub-key \
  PESAPAL_CONSUMER_SECRET=stub-secret \
  PESAPAL_IPN_ID=stub-ipn \
  PESAPAL_CALLBACK_URL="http://127.0.0.1:${WEB_PORT}/checkout/pesapal/callback" \
  PESAPAL_CANCELLATION_URL="http://127.0.0.1:${WEB_PORT}/checkout/pesapal/cancelled" \
  PROVIDER_DELIVERY_ENABLED=false \
  CUSTOMER_COMMUNICATIONS_ENABLED=false \
  NOTIFICATION_DELIVERY_ENABLED=false \
  NOTIFICATIONS_LIVE_SEND_ENABLED=false \
  npx tsx apps/api/src/interfaces/http/server.ts >"$LOG_DIR/api.log" 2>&1 &
API_PID=$!

for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:${API_PORT}/health/live" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "http://127.0.0.1:${API_PORT}/health/live" >/dev/null 2>&1 \
  || { tail -40 "$LOG_DIR/api.log"; die "the API did not become live on ${API_PORT}"; }
printf 'API live on %s\n' "$API_PORT"

# --- Storefront --------------------------------------------------------------
# Built, then served from the build output. Running the dev server instead would
# prove something about the dev server; the customer meets the build.
say 'Building and starting the Astro storefront'
( cd apps/web && PUBLIC_API_BASE_URL="http://127.0.0.1:${API_PORT}" npx astro build ) \
  >"$LOG_DIR/web-build.log" 2>&1 || { tail -40 "$LOG_DIR/web-build.log"; die 'the storefront build failed'; }

env \
  NODE_ENV=production \
  HOST=127.0.0.1 \
  PORT="$WEB_PORT" \
  PUBLIC_API_BASE_URL="http://127.0.0.1:${API_PORT}" \
  PUBLIC_SITE_ORIGINS="http://127.0.0.1:${WEB_PORT}" \
  CHECKOUT_INTENT_SECRET="$E2E_INTENT_SECRET" \
  JWT_SECRET="$E2E_JWT_SECRET" \
  node apps/web/dist/server/entry.mjs >"$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!

for _ in $(seq 1 120); do
  curl -fsS -o /dev/null "http://127.0.0.1:${WEB_PORT}/" && break
  sleep 0.5
done
curl -fsS -o /dev/null "http://127.0.0.1:${WEB_PORT}/" \
  || { tail -40 "$LOG_DIR/web.log"; die "the storefront did not start on ${WEB_PORT}"; }
printf 'storefront live on %s\n' "$WEB_PORT"

# --- Proofs ------------------------------------------------------------------
say 'Running the end-to-end checkout proofs'
set +e
env \
  DATABASE_URL="$PG_URL" \
  E2E_WEB_BASE="http://127.0.0.1:${WEB_PORT}" \
  E2E_API_BASE="http://127.0.0.1:${API_PORT}" \
  E2E_STUB_BASE="http://127.0.0.1:${STUB_PORT}" \
  npx tsx scripts/qa/checkout-e2e-proofs.ts
PROOF_CODE=$?
set -e

if [[ $PROOF_CODE -ne 0 ]]; then
  say 'API log tail (proofs failed)'
  tail -40 "$LOG_DIR/api.log" || true
  say 'storefront log tail'
  tail -40 "$LOG_DIR/web.log" || true
fi

exit "$PROOF_CODE"
