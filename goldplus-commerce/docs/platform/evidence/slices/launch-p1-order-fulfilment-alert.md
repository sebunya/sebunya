# Launch Phase 1 (Section 9.3) — Order-to-Admin Fulfilment Alert: live evidence

Verified on a production-shaped local stack (PostgreSQL 16, DB `launchcheck`, API on
`127.0.0.1:3000`, `NODE_ENV=development`). No external providers were called; no customer
email/SMS/WhatsApp was sent. UAT identities are fixture-only (`*@fixture.local`).

## Migration

Fresh replay `0000 → 0029` on an empty database completed with the four known-invalid 0018
statements skipped and 0028 applying the repair (unchanged historical-integrity shim).
`\d fulfilment_tasks` shows the expected columns, the **unique** `order_id` index, the `status`
and `created_at` indexes, and both uuid FKs (`order_id → orders.id`, `assigned_to → users.id`).

## Live HTTP behaviour

| # | Action | Result |
|---|---|---|
| 1 | `POST /commerce/orders/create` (2× Fast Charger, 1× USB-C Cable) | Order created; one fulfilment task `NEW`, unpaid, contact masked `077****56`, summary `Kampala · Nakawa · Ntinda`, both product lines (90,000 + 15,000 = **UGX 105,000**), `itemCount=3`, warnings "confirm delivery fee" + "do not dispatch until paid" |
| 2 | Duplicate `POST` with same `clientOrderKey` | `idempotentReplay:true`; **badge stays 1** — no second task |
| 3 | `GET /admin/fulfilment/badge` (owner) | `{ newOrders: 1 }` |
| 4 | `GET /admin/fulfilment?activeOnly=true` (owner) | Task with full product summary, truthful payment status |
| 5 | `GET /admin/fulfilment` (no token) | **401** — fails closed |
| 6 | `PATCH /:id/status {toStatus:"DELIVERED"}` from NEW | **400 INVALID_TRANSITION** — illegal skip rejected |
| 7 | `PATCH /:id/status {toStatus:"ACKNOWLEDGED"}` | `200 { from:"NEW", to:"ACKNOWLEDGED" }` |
| 8 | `GET /admin/fulfilment/badge` after acknowledge | `{ newOrders: 0 }` |
| 9 | `audit_logs` where `entity='fulfilment_task'` | `FULFILMENT_TASK_TRANSITIONED` row present (timeline) |

## Idempotency & provider independence (proven)

- Unique `order_id` constraint + repository `onConflictDoNothing` collapse duplicate submissions,
  callbacks and retries to a single task (step 2, badge unchanged).
- The internal task/badge/queue path calls no external provider; a fulfilment failure is caught
  and never fails the already-persisted order (checkout hook wraps the call in try/catch).
- PaymentConfirmed → ready-for-preparation is wired idempotently into both the PesaPal callback
  and IPN completed branches; covered by `tests/unit/LaunchP1OrderFulfilmentAlert.test.ts`.

## Unit tests

`tests/unit/LaunchP1OrderFulfilmentAlert.test.ts` — 17 tests (lifecycle rules, contact masking,
idempotent create, unpaid warning, idempotent payment-confirmed, audited/rejected transitions,
badge + queue filtering). Full suite 174 files / 3,838 tests green; architecture 10/10.
