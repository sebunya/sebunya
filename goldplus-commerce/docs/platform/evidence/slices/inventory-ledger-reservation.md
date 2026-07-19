# Inventory ledger + reservation (Section 12) — live evidence

Verified on a production-shaped local stack (PostgreSQL 16, DB `launchcheck`, API on
`127.0.0.1:3000`). Rehearsal only — not production; nothing marked LIVE_VERIFIED.

## Migration

`0031_slippery_grim_reaper.sql` applied cleanly on the **populated** `launchcheck`
database (adds `reserved_quantity` + `reorder_point` to products, both default 0, and the
`inventory_reservations` table with a unique `(order_id, product_id)` index). Fresh replay
`0000 → 0031` on a new DB also passes.

## Live behaviour (charger: stock 5, reorder point 2)

| # | Action | Result |
|---|---|---|
| 1 | Order A places 2 chargers | reserved 2 → product 5/2 (stock/reserved) |
| 2 | Order B places 4 chargers (only 3 available) | **oversell prevented** — reserved exactly 3, product 5/5 (reserved never exceeds stock); reservation row `4/3 reserved`; fulfilment task carries `Backorder: 1 of 4 unit(s)…` |
| 3 | `GET /admin/inventory/low-stock` | charger `available 0 ≤ reorder 2` → `lowStock: true` |
| 4 | Order A task → READY_FOR_DISPATCH | **consume**: stock 5→3, reserved 5→3, reservation `consumed` |
| 5 | Order B task → CANCELLED | **release**: reserved 3→0 (stock stays 3), reservation `released` |
| 6 | `GET /admin/inventory/availability` | stock 3 / reserved 0 / available 3 — consistent |

## Correction: all-or-nothing reservation + truthful hold (no silent oversell)

The initial cut reserved best-effort (partial per line) and let an under-reserved order
proceed as a normal NEW fulfilment task — a silent-oversell risk. Corrected:

- **All-or-nothing**: `reserveForOrder` locks all product rows (`FOR UPDATE`, deterministic
  order), and either reserves every line fully or reserves **nothing**. No partial holds.
- **No silent acceptance**: when the reservation is not fully satisfied — or cannot be
  confirmed at all (DB error) — the fulfilment task opens **ON_HOLD (backordered)**, never
  NEW, so it is never presented to staff as ready for preparation. The checkout response
  carries `stockConfirmed` + `fulfilmentState: ON_HOLD_BACKORDERED | STOCK_CONFIRMED`.
- **Real-PostgreSQL concurrency proof** (`src/scripts/inventory-concurrency-proof.ts`, run
  against `launchcheck`): two reservations race for 4 units of a stock of 5 →
  `{winners:1, reservedAfterRace:4, neverOversold:true, verdict:"PASS"}`. Reserved never
  reaches 8. The script refuses `NODE_ENV=production` and cleans up its rows.
- 0031 integrity re-checked on the populated DB: unique `(order_id,product_id)` idempotency
  index present, both FKs present, 0 orphan reservations, invariant `reserved ≤ stock`
  holds for all products, migration ledger 32 rows.

## Guarantees proven

- **Oversell prevention**: atomic `SELECT … FOR UPDATE` + guarded increment means
  `reserved_quantity` can never exceed `stock_quantity` even across concurrent orders
  (unit test "two orders cannot oversell the same stock").
- **Backorder handling**: shortfall reserved-vs-requested is recorded and surfaced as a
  truthful fulfilment-task warning (never silently oversold).
- **Idempotency**: reservation keyed by `order_id` (unique index); duplicate OrderPlaced
  returns the existing outcome; release/consume are no-ops once applied.
- **Lifecycle wiring**: OrderPlaced reserves; fulfilment READY_FOR_DISPATCH consumes
  (deducts on-hand); CANCELLED releases. All best-effort — inventory never fails an order
  or a transition.

## Tests

`tests/unit/InventoryLedgerReservation.test.ts` — 12 tests (domain math, oversell,
backorder, idempotency, release, consume, two-orders-no-oversell, low-stock). Full suite
175 files / 3,858 tests green; architecture 10/10.
