# R3.1 — Commercial-intelligence reconciliation matrix (C1)

Date: 2026-08-06 · Baseline verified: HEAD=f370b35 (clean, synced), production=f370b35, rollback=5cec0e7.

## The facts that shape everything below (verified against production)

1. **Orders already carry the stitching columns (`anonymous_id`, `cart_id`, `attribution_id`, `session_id`, `browser_id` — Pass 13A) but NOTHING ever wrote them: 0 of 20 orders are stamped.** The checkout chain (route → ExecuteCheckoutIntentUseCase → CheckoutUseCase → savePricedOrder) drops the cartId it already holds and never sees a profile. Historic orders are therefore UNATTRIBUTABLE — honestly classified, never inferred.
2. **`product_prices.cost_price` and `dealer_price` exist and are 100% NULL/zero.** There is no historical COGS and no current COGS. Profit contribution is PARTIAL by construction until the operator enters costs; the machinery (line-level cost snapshots captured at order creation, forward-only) is internal work.
3. **Production order truth: 20 orders, 0 paid, 0 completed** (10 received/unpaid, 6 received/failed, 3 pending_payment/failed, 1 cancelled). Every commercial headline will honestly read "not enough data yet" on day one — that is the designed behaviour, not a failure.
4. **No refund/return line concept exists.** Canonical refund truth is the payments programme's async provider reversal (payment attempt status `reversed`, `PAYMENT_REFUND_REQUESTED` audit). Full-order reversal is derivable; line-level partial refunds are UNSUPPORTED (named in-product).
5. **No media/spend source exists** (campaigns + utm_links only). ROAS requires a canonical media-cost fact table (built empty, server-ingested, admin-permissioned) and stays UNAVAILABLE REASON=MEDIA_COST_NOT_CONNECTED until real spend rows exist.
6. **checkout.astro submits SSR-side** (`submitCheckout` in frontmatter) — the web server can forward the HttpOnly visit token, so orders can be stamped with the server-issued profile id. This is the missing link that makes PROVEN attribution possible.

## Metric matrix

METRIC=direct_attributed_net_revenue · BUSINESS_DEFINITION=net line revenue (final_line_total) of PAID, non-cancelled order items whose product was recommendation-ATC'd or clicked by the SAME server profile inside the window, refund-reversed · CURRENT_DATA_OWNER=orders/order_items (line prices are canonical snapshots) + recommendation_events v2 · CURRENT_LINKAGE=events.profile_id ↔ orders.profile_id (NEW) + order_items.product_id ↔ events.recommendation_product_id · CURRENT_PROOF=none (no stamped orders yet) · MISSING_LINK=orders.profile_id column + checkout stamping · CLASSIFICATION=BUILD_GAP_ONLY · ACTION=migration 0101 + checkout chain + read-projection

METRIC=paid/fulfilled/completed_order_conversion · DEFINITION=funnel stage rates with canonical statuses (payment_status='paid'; status='dispatched|completed'; status='completed') and minimum denominators · OWNER=orders + OrderStateMachine · LINKAGE=same profile join · CLASSIFICATION=BUILD_GAP_ONLY

METRIC=assisted_attribution · DEFINITION=valid impression/secondary touches on an order that has a primary attribution elsewhere or none; never summed into headline revenue · CLASSIFICATION=BUILD_GAP_ONLY

METRIC=incremental_revenue · CLASSIFICATION=UNSUPPORTED (no experiment has run; requires holdout + SRM + sample) — stays UNAVAILABLE by rule, never renamed

METRIC=realised_customer_value_30/60/90/180/365 · DEFINITION=net paid revenue per customer cohort keyed on canonical user_id (merge-safe: profile→customer link resolves before counting; one customer counted once) · OWNER=orders(user_id, paid) + experience_profiles(customer_id) · CLASSIFICATION=BUILD_GAP_ONLY

METRIC=predicted_CLV · CLASSIFICATION=UNSUPPORTED (no validated model, near-zero history) → UNAVAILABLE

METRIC=contribution_profit · DEFINITION=net line revenue − line COGS snapshot − named allocations; PARTIAL while any component missing, with components listed · OWNER=order_items + NEW order-line cost snapshots (forward-only) · MISSING_LINK=cost values themselves · CLASSIFICATION=BUILD_GAP_ONLY (machinery) + EXTERNAL_DATA_REQUIRED (operator-entered costs)

METRIC=reported/contribution_ROAS · OWNER=NEW media_cost_facts · CLASSIFICATION=BUILD_GAP_ONLY (table+ingestion) + EXTERNAL_DATA_REQUIRED (spend) → UNAVAILABLE REASON=MEDIA_COST_NOT_CONNECTED until rows exist; activates automatically from data

METRIC=refund_reversal · DEFINITION=orders whose payment attempt reached `reversed` are excluded from attributed revenue (full reversal, exactly once — recompute-on-read makes double reversal impossible) · PARTIAL: line-level refunds UNSUPPORTED (no canonical concept)

METRIC=attach_rate/AOV/units_per_order/share_of_paid_orders/new_vs_returning/refund_rate/cancellation_rate · CLASSIFICATION=BUILD_GAP_ONLY over the same projection · Each carries numerator/denominator/min-sample in the payload

## Attribution model (single owner)

Owner: `RecommendationCommercialAttributionService` — a **read-projection** (CTE SQL, bounded windows), not a table: with the current volume it is exact, idempotent, replayable and refund-reversible *by construction* (every read recomputes against canonical truth). Materialisation is deferred until a measured need (§24); the projection is written so its SELECT can later populate a table unchanged.

- Precedence: RECOMMENDATION_ADD_TO_CART (7d) > RECOMMENDATION_CLICKED (7d) > RECOMMENDATION_IMPRESSION view-through (1d, assist-only).
- Tie-break at same level: last eligible touch (latest event before order), deterministic.
- Join identity: `events.profile_id = orders.profile_id` — both server-issued. No name/phone/time-proximity joins, ever.
- One primary per order line (DISTINCT ON with deterministic ordering); assisted touches listed separately.
- Classes: PROVEN (profile join) only in headlines. Historic unstamped orders = UNATTRIBUTABLE. Orders with events but broken chains = ATTRIBUTION_INSUFFICIENT.
- Paid = payment_status='paid' AND status<>'cancelled' AND no `reversed` payment attempt.

## Residuals from R3 (this unit's scope)

- JSONB double-encoding → cure at the TWO writers (event repo, materializer cache) with canonical `::jsonb` casts; readers keep transition tolerance; real-PG round-trip regression. Historic rows preserved.
- Relay per-visitor attribution → read exact residual wording (DECISIONS D-R9-5); attempt closure at the trusted-proxy layer; otherwise classify.
- CategoryPopularRail → no canonical category landing pages exist (`/shop?category=` is a filter on one page) → EXTERNAL_DEPENDENCY, recorded.
- Playwright/a11y → local Node is v20 (astro@4 runs on it; the tooling matrix is checked in C10); prove what is provable, record exact residuals.
