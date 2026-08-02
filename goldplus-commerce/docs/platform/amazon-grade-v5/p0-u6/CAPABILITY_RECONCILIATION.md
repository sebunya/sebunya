# P0–U6 Capability Reconciliation (V2)

Applied to a mature branch that already completed the V5 Amazon-Grade programme,
so most P0-1/P0-2 outcomes are ALREADY_VERIFIED by current code + tests.

## P0-1 (security remediation gate): 11/11 VERIFIED
10 ALREADY_PROVEN (webhook 401/422, server price, admin auth+RBAC, actor-from-session,
order 404, login timing dummy-hash, login 429, admin-auth arch test) + 1 GAP CLOSED:
**AC2 webhook timestamp replay binding** — `x-goldplus-timestamp` binds into the
signature (`${ts}.${rawBody}`) with a 300s/60s freshness window (→401 STALE_TIMESTAMP),
additive/backward-compatible. This closes the last stop-ship residual (7.2).

## P0-2 (data & concurrency): 8/9 VERIFIED, 1 OPEN
7 ALREADY_PROVEN (bigint 0062, outbox fencing, tx retry, slow-query redaction,
route-family keys, shared Redis limits) + 1 GAP CLOSED: **AC9 FK indexes** (migration
0066: order_items.order_id, cart_items.cart_id, product_prices.product_id,
products.category_id; EXPLAIN confirms index scan). **OPEN: AC2/AC3 order_events
append-only ledger** — the OrderStateMachine rejects illegal transitions (proven) but
there is no order_events table recording each transition in-transaction. This is the
one remaining internally-controllable P0 gap.

## Units U1–U6: STILL_MISSING (gap-only new feature builds)
U1 pricing engine/promotions/coupons · U2 device catalogue/compatibility · U3 reviews/
ratings · U4 creator platform · U5 flash sales · U6 SEO/AEO. Each reconciled against
canonical owners before build; none reopened from P0 work. Deferred to subsequent
sub-units per the durable phase machine.
