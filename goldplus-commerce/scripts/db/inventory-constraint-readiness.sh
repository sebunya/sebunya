#!/usr/bin/env bash
# =============================================================================
# GOLDPLUS — INVENTORY CONSTRAINT PRODUCTION-READINESS GATE
#
# `products_reserved_within_stock` was introduced NOT VALID so a pre-existing
# violation could not block the deploy. That is a starting position, not a
# resting one: while it stays unvalidated, PostgreSQL reports convalidated =
# false and the invariant is only enforced for new writes.
#
# This gate reports the exact position and, when it is clean, validates the
# constraint. It NEVER releases a reservation or raises stock to make validation
# pass — both are decisions about specific customer orders, and a script that
# quietly made them would be destroying the evidence the constraint exists to
# surface.
#
# Exit codes
#   0  validated (convalidated = true), or already validated
#   3  violations remain and are not covered by a waiver — NOT READY
#   4  waiver file present but malformed
#   5  validation was attempted and failed
#
# Usage: inventory-constraint-readiness.sh [--report-only] [--waiver <file>]
# =============================================================================
set -Eeuo pipefail

CONSTRAINT=products_reserved_within_stock
REPORT_ONLY=0
WAIVER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --report-only) REPORT_ONLY=1; shift ;;
    --waiver) WAIVER="${2:?--waiver needs a file}"; shift 2 ;;
    *) printf 'UNKNOWN_ARGUMENT: %s\n' "$1" >&2; exit 2 ;;
  esac
done

psql_q() { psql -v ON_ERROR_STOP=1 -q -tAc "$1"; }

printf '== inventory constraint readiness ==\n'

STATE="$(psql_q "select coalesce((select convalidated from pg_constraint where conname='${CONSTRAINT}'), null)::text")"
if [[ -z "$STATE" ]]; then
  printf 'CONSTRAINT_MISSING: %s does not exist. Apply migration 0052 first.\n' "$CONSTRAINT" >&2
  exit 3
fi
printf 'constraint present, convalidated = %s\n' "$STATE"

if [[ "$STATE" == "true" ]]; then
  printf 'READY: %s is already validated.\n' "$CONSTRAINT"
  exit 0
fi

# ---------------------------------------------------------------------------
# Reconciliation report: which products, by how much, and which orders are
# affected. An operator cannot act on a bare count.
# ---------------------------------------------------------------------------
VIOLATIONS="$(psql_q "select count(*) from products where reserved_quantity > stock_quantity")"
printf 'violating products: %s\n' "$VIOLATIONS"

if [[ "$VIOLATIONS" != "0" ]]; then
  printf '\n-- affected products --\n'
  psql -q -c "
    select p.id, p.sku, p.name,
           p.stock_quantity as stock,
           p.reserved_quantity as reserved,
           p.reserved_quantity - p.stock_quantity as unbacked
    from products p
    where p.reserved_quantity > p.stock_quantity
    order by (p.reserved_quantity - p.stock_quantity) desc"

  printf '\n-- customer orders holding the unbacked reservations --\n'
  psql -q -c "
    select r.order_id, o.order_number, o.status, o.reservation_state,
           r.product_id, r.reserved_quantity
    from inventory_reservations r
    join products p on p.id = r.product_id
    join orders o on o.id = r.order_id
    where r.status = 'reserved'
      and p.reserved_quantity > p.stock_quantity
    order by o.created_at"

  printf '\nREMEDIATION (operator, not this script):\n'
  printf '  Each row above is a promise to a named customer. Resolve each one by\n'
  printf '  either cancelling/releasing that order, or receiving stock to back it.\n'
  printf '  Do NOT release reservations or raise stock merely to make this pass.\n'
fi

# ---------------------------------------------------------------------------
# Waivers: a formally recorded decision, with evidence, for rows that will not
# be reconciled. One product id per line, "<uuid> <reason>". Comments with #.
# ---------------------------------------------------------------------------
WAIVED=0
if [[ -n "$WAIVER" ]]; then
  if [[ ! -f "$WAIVER" ]]; then
    printf 'WAIVER_FILE_MISSING: %s\n' "$WAIVER" >&2; exit 4
  fi
  while IFS= read -r wline; do
    [[ -z "${wline// }" || "$wline" == \#* ]] && continue
    id="${wline%% *}"; reason="${wline#* }"
    if [[ ! "$id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
      printf 'WAIVER_MALFORMED: %s\n' "$wline" >&2; exit 4
    fi
    if [[ -z "${reason// }" || "$reason" == "$id" ]]; then
      printf 'WAIVER_WITHOUT_EVIDENCE: %s has no recorded reason\n' "$id" >&2; exit 4
    fi
    WAIVED=$((WAIVED + 1))
  done < "$WAIVER"
  printf 'waivers recorded: %s\n' "$WAIVED"
fi

UNEXPLAINED="$(psql_q "
  select count(*) from products p
  where p.reserved_quantity > p.stock_quantity
  $( [[ -n "$WAIVER" ]] && printf "and p.id::text not in (%s)" "$(
      awk '!/^#/ && NF {printf "\047%s\047,", $1}' "$WAIVER" | sed 's/,$//' || true
    )" || true )")"

printf 'unexplained violations: %s\n' "$UNEXPLAINED"

if [[ "$UNEXPLAINED" != "0" ]]; then
  printf '\nNOT_READY: %s unexplained violating row(s). Reconcile or formally waive them.\n' "$UNEXPLAINED" >&2
  exit 3
fi

if [[ "$VIOLATIONS" != "0" ]]; then
  # Waived rows still violate, so VALIDATE would fail. Say so plainly rather
  # than pretending the gate passed.
  printf '\nNOT_READY: every violation is waived, but a waived row still violates the\n'
  printf 'constraint, so VALIDATE CONSTRAINT cannot succeed. A waiver defers the\n'
  printf 'commercial decision; it does not make the data consistent.\n' >&2
  exit 3
fi

if [[ "$REPORT_ONLY" == "1" ]]; then
  printf '\nREPORT_ONLY: zero violations. Re-run without --report-only to validate.\n'
  exit 0
fi

printf '\nvalidating %s ...\n' "$CONSTRAINT"
if ! psql -v ON_ERROR_STOP=1 -q -c "ALTER TABLE products VALIDATE CONSTRAINT ${CONSTRAINT}"; then
  printf 'VALIDATION_FAILED\n' >&2; exit 5
fi

FINAL="$(psql_q "select convalidated from pg_constraint where conname='${CONSTRAINT}'")"
if [[ "$FINAL" != "t" && "$FINAL" != "true" ]]; then
  printf 'VALIDATION_DID_NOT_TAKE: convalidated = %s\n' "$FINAL" >&2; exit 5
fi

printf 'READY: %s validated, convalidated = true.\n' "$CONSTRAINT"
exit 0
