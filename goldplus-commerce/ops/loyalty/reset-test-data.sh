#!/usr/bin/env bash
# Reset every customer's loyalty data to zero. Runs ON the host.
#
# For one situation only: every order so far was a test (owner, 2026-10-07),
# so every point, level, referral, badge, scratch card and redemption built on
# them is fiction. The PROGRAMME is kept: settings, rules, levels, missions,
# badges on offer, scratch-card campaigns and prizes, terms date. Orders,
# customers, phone verification and referral CODES are not touched.
#
#   ./ops/loyalty/reset-test-data.sh              # dry run: counts only
#   CONFIRM=RESET-LOYALTY ./ops/loyalty/reset-test-data.sh --apply
#
# --apply: 1. dumps every table it empties (the restore path), 2. empties them
# in ONE transaction (all or nothing), 3. cancels loyalty messages still
# queued, so nobody is emailed about points that no longer exist.
# The append-only ledger trigger is never switched off: TRUNCATE empties the
# table as a whole, which is the deliberate, auditable act this is.
set -euo pipefail
MODE="${1:-dry-run}"
C="${PG_CONTAINER:-goldplus-commerce-postgres-1}"
if [ -n "${LOCAL_DB:-}" ]; then   # tests only: a connection string, no docker
  psql_run() { psql "$LOCAL_DB" -v ON_ERROR_STOP=1 -X -q; }
  pgdump_run() { pg_dump "$LOCAL_DB" -Fc --data-only "$@"; }
else
  psql_run() { docker exec -i "$C" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -X -q'; }
  pgdump_run() { docker exec "$C" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --data-only "$@"' _ "$@"; }
fi
BACKUP_DIR="${BACKUP_DIR:-/root/goldplus-db-backups}"

# Customer loyalty data. Nothing outside this list references these tables
# (checked 2026-10-07), so TRUNCATE without CASCADE cannot reach further.
TABLES="loyalty_draw_results loyalty_draw_tokens loyalty_redemptions loyalty_expiry_notices
loyalty_fraud_signals loyalty_tier_assignments loyalty_referrals loyalty_account_merges
loyalty_ledger_entries loyalty_accounts loyalty_liability_snapshots loyalty_daily_control_totals
customer_badges"

counts_sql() {
  local first=1
  for t in $TABLES; do
    [ $first = 1 ] || printf ' union all '
    printf "select '%s' as table_name, count(*)::bigint as rows from %s" "$t" "$t"
    first=0
  done
  printf " union all select 'queued loyalty messages', count(*) from outbox_events where is_processed = false and event_type like 'LOYALTY\\_%%'"
  printf " union all select 'scratch-card points counted', coalesce(sum(points_awarded), 0) from loyalty_draw_campaigns;\n"
}

echo "=== loyalty data now"
counts_sql | psql_run

if [ "$MODE" != "--apply" ]; then
  echo
  echo "Dry run: nothing changed. To reset: CONFIRM=RESET-LOYALTY $0 --apply"
  exit 0
fi
[ "${CONFIRM:-}" = "RESET-LOYALTY" ] || { echo "STOP: set CONFIRM=RESET-LOYALTY to apply"; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/goldplus-loyalty-pre-reset-$STAMP.dump"
echo "=== 1. BACKUP of the tables being emptied → $DUMP"
TFLAGS=(); for t in $TABLES; do TFLAGS+=(-t "$t"); done
pgdump_run "${TFLAGS[@]}" > "$DUMP"
[ -s "$DUMP" ] || { echo "STOP: empty backup, nothing changed"; exit 1; }
ls -l "$DUMP" | awk '{print "backup bytes", $5}'

echo "=== 2. RESET (one transaction)"
TLIST=$(echo $TABLES | tr ' ' ',')
psql_run <<SQL
begin;
set local lock_timeout = '10s';
truncate $TLIST;
update outbox_events
   set is_processed = true, status = 'processed', processed_at = now(),
       last_error = 'CANCELLED: loyalty reset, all orders were tests (2026-10-07)'
 where is_processed = false and event_type like 'LOYALTY\_%';
-- The campaign rows are kept (only their counters reset), so their old
-- counters are recorded here rather than in the dump.
insert into audit_logs (actor_id, action, entity, entity_id, previous_state, new_state)
select null, 'LOYALTY_TEST_DATA_RESET', 'loyalty_programme', gen_random_uuid(),
       jsonb_build_object('scratchCardCampaigns', coalesce(jsonb_agg(jsonb_build_object('id', id, 'pointsAwarded', points_awarded, 'tokensGranted', tokens_granted)), '[]'::jsonb)),
       jsonb_build_object('reason', 'every order so far was a test', 'backup', '$DUMP')
from loyalty_draw_campaigns;
update loyalty_draw_campaigns set points_awarded = 0, tokens_granted = 0;
commit;
SQL

echo "=== 3. loyalty data after"
counts_sql | psql_run
echo "RESET DONE. Undo, if ever needed (tables must be empty):"
echo "  docker exec -i $C sh -c 'pg_restore -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --data-only --disable-triggers' < $DUMP"
