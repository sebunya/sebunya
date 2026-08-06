#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# The integration test environment (payments brief, 2026-08-06).
#
# Roughly fifty of the 111 integration tests had NEVER EXECUTED ANYWHERE, for
# want of Redis and a database. The code that broke was precisely the code
# with no coverage. This script removes the excuse: one command stands up
# everything, runs all 111 with nothing skipped, and tears nothing down (the
# databases are cheap and reuse makes the loop fast).
#
# THE SCHEMA COMES FROM PRODUCTION, NOT FROM THE MIGRATION CHAIN. Building a
# database from the migration files produces an orders table with 8 columns;
# production's has 36. The chain cannot reproduce the schema it supposedly
# built (recorded in docs/payments/DECISIONS.md), so the honest test target is
# a schema-only snapshot of production, committed at
# tests/integration/env/production-schema.sql and refreshed with
# --refresh-schema.
#
# Layout (the env var names ARE the isolation design — conflating them lets
# the destructive-by-design migration suites clobber everyone else):
#   goldplus_test_commerce   production schema   DATABASE_URL + COMMERCE_TEST_DATABASE_URL
#   goldplus_test_auth       production schema   AUTH_TEST_DATABASE_URL
#   goldplus_test_analytics  EMPTY — its suites self-provision and DROP TABLES
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

SCHEMA=tests/integration/env/production-schema.sql
PGUSER_LOCAL="${PGUSER:-$(whoami)}"
BASE="postgresql://${PGUSER_LOCAL}@localhost:5432"

if [[ "${1:-}" == "--refresh-schema" ]]; then
  echo "Refreshing schema snapshot from production..."
  ssh goldplus-prod "cd /opt/goldplus/app/goldplus-commerce && docker compose -f docker-compose.production.yml --env-file .env.production exec -T postgres pg_dump -U goldplus --schema-only --no-owner --no-acl goldplus" > "$SCHEMA"
  echo "Snapshot refreshed: $(wc -l < "$SCHEMA") lines"
  shift
fi

[[ -f "$SCHEMA" ]] || { echo "Missing $SCHEMA — run with --refresh-schema first."; exit 1; }

pg_isready -q || { echo "PostgreSQL is not running locally."; exit 1; }
redis-cli ping >/dev/null 2>&1 || { echo "Starting redis..."; redis-server --daemonize yes --port 6379 --save ''; sleep 1; }

rebuild() {
  local db="$1" load="$2"
  dropdb --if-exists "$db"
  createdb "$db"
  if [[ "$load" == "schema" ]]; then psql -q "$db" < "$SCHEMA" >/dev/null; fi
}

rebuild goldplus_test_commerce schema
rebuild goldplus_test_auth schema
rebuild goldplus_test_analytics empty

# The production schema snapshot predates the recommendation-programme
# migrations; apply them so EVERY suite sees the full schema (idempotent —
# IF NOT EXISTS throughout). Suites keep their own guarded application for
# standalone runs.
for m in 0099_recommendation_event_contract 0100_experience_profiles 0101_order_profile_stitching 0102_commercial_costs 0103_refund_ledger; do
  sed 's/--> statement-breakpoint//' "apps/api/src/infrastructure/db/migrations/${m}.sql" | psql -q goldplus_test_commerce >/dev/null
done

export DATABASE_URL="${BASE}/goldplus_test_commerce"
export COMMERCE_TEST_DATABASE_URL="${BASE}/goldplus_test_commerce"
export AUTH_TEST_DATABASE_URL="${BASE}/goldplus_test_auth"
export ANALYTICS_TEST_DATABASE_URL="${BASE}/goldplus_test_analytics"
export REDIS_TEST_URL="redis://127.0.0.1:6379"

echo "Environment ready. Running: ${*:-npx vitest run tests/integration}"
if [[ $# -gt 0 ]]; then "$@"; else npx vitest run tests/integration; fi
