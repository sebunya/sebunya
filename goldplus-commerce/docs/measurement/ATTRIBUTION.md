# Attribution module (migration 0156)

Which channel brought each sale, what that channel cost, and what it returned.
Live at `/admin/measurement/channel-report` (API `/admin/attribution`). The
nightly Markov/Shapley page (`/admin/measurement/attribution-models`, 0141)
still exists and is unchanged.

## 1. Why `attribution_touchpoints` is empty (diagnosis, 2026-09-25)

There are **two** touch tables, and the one production was checked against is
the wrong one.

| Table | Written by | State |
|---|---|---|
| `public.attribution_touchpoints` (0013) | `ConversionRouter.routeAndRecord()` only | **No caller anywhere in the codebase** (grep: the method is defined and never called). The table can only ever hold 0 rows. It is a per-event "match quality" log, not a landing log. |
| `measurement.touchpoint` (0141) | collector v2: `BaseLayout` → `recordLandingTouch()` → `POST api.…/telemetry/collect/batch` → `CollectBrowserBatchUseCase` → `DrizzleCollectorStore.saveTouch` | The real landing touches: UTM, click-id types, outside referrer or direct, keyed on the server-set `_fp_cid`. Verified 202/replay/409 in production on 2026-09-20. |

What was actually broken was the **order side**, not the landing side:

- Nothing tied a touch to the order it led to. The only join (touch
  `anonymous_id` = `order_attribution.fp_client_id`) was made inside the nightly
  batch and then thrown away.
- `DrizzlePaymentAttributionRepository.linkPaymentToTouchpoints()` (called on
  PesaPal reconcile) was an **empty method** whose comment said the checkout
  "has already stamped orderId onto the touchpoints". Nothing did that. Its
  reader queried the dead table and returned `source: 'unknown'`.

Fixed:

- At checkout (after `order_attribution` is recorded, best-effort, never on the
  money path) `RecordCheckoutAttributionUseCase` links the visitor's
  customer-class touches from the 30 days before the order into
  `measurement.order_touch_link` and credits the order under every model.
- The PesaPal reconcile hook now does the same (`linkPaymentToTouchpoints`), and
  its reader returns the linked touches with their real source/medium/campaign.
- The nightly attribution batch recomputes every order from the last 120 days
  (late answers, reversed codes and status changes are picked up by morning).
- `public.attribution_touchpoints` is left as it is (0 rows, still read by the
  Measurement Tower's match-quality card, which says "No data").

Check on production (read-only):

```sql
select traffic_class, channel, count(*) from measurement.touchpoint
where environment = 'production' group by 1, 2 order by 3 desc;
select count(*) from measurement.order_touch_link;           -- grows from the first order after deploy
select model, count(distinct order_id) from measurement.order_channel_credit group by 1;
```

If `measurement.touchpoint` itself is empty, look at the beacon, not this
module: CSP `connect-src` must list `https://api.shopgoldplus.com` (it does),
and Cloudflare must not challenge `POST /telemetry/collect/batch`.

To credit orders placed before the deploy, press **Recompute** on the channel
report (or wait for the nightly run). Orders older than their visitor's touches
(or with no `fp_client_id`) show as "No recorded source".

## 2. Evidence per order and the models

One journey per order, oldest first, from three labelled kinds of evidence:

1. **Observed**: the linked landing touches (channel from `classifyChannel`).
   Consecutive touches on the same channel count once.
2. **Code**: a creator or promo code redeemed on the order (not reversed), as
   the final touch at the moment of the order. A code assigned to a creator, or
   a primary `creator_attributions` row, is channel `creator` (detail = handle);
   any other code is `promo_code` (detail = the code, or the promotion's name
   for a batch of single-use codes).
3. **Declared**: the customer's (or staff's) answer to "How did you hear about
   us?". Used in the journey **only when there is no observed or code touch**,
   and marked `basis = 'declared'`. Ambiguous answers stay ambiguous:
   "Facebook" is `social_declared`, never paid social.

Models (`measurement.order_channel_credit`, one row per order × model ×
channel × detail, with weight and integer UGX credit; `model_version =
channel-credit-v1`): `last_click`, `first_touch`, `linear`, `time_decay`
(half-life 7 days), `position_based` (40/20/40) and `self_reported` (the answer
alone). Weights sum to 1 and the money is split with exact largest-remainder
allocation (`domain/measurement/Attribution.ts`), so no model creates or loses a
shilling. An order with no evidence gets no rows and the report shows it as its
own "No recorded source" line, never spread over channels.

Revenue = goods value (order total minus delivery fee). A sale = not
cancelled/failed/delivery_failed, not refunded/reversed, and an online
(`pesapal`) order only once paid. Pay-on-delivery orders count when placed.

## 3. Offline and WhatsApp

- **Checkout**: one optional select, "How did you hear about us?", default
  "Prefer not to say" (sends nothing). Closed list in
  `packages/shared/src/attribution/heardAbout.ts`. An unknown value is dropped,
  never a refused checkout.
- **WhatsApp click-to-chat**: on every storefront page (`recordLandingTouch`
  registers one delegated click listener; BaseLayout is unchanged), a tap on a
  `wa.me/<number>` or `api.whatsapp.com/send?phone=` link appends a visible line
  `Ref GP-XXXXXX` to the prefilled message (WhatsApp's documented `text`
  parameter, percent-encoded) and beacons a `whatsapp_ref` event. The collector
  files the code against the **server-set** visitor id in
  `measurement.whatsapp_ref` (first writer wins; automation is filed as
  automated and never matched). Share links (`wa.me/?text=`) are left alone.
- **Staff** (order page → "Where this order came from", `orders.manage`,
  audited as `ORDER_SOURCE_RECORDED`): pick the answer and/or paste the code
  from the chat. A code nobody was issued is refused. A valid code links that
  visitor's visits to the order and recomputes it; the newest staff answer beats
  the customer's. Answers are insert-only evidence.

Staff-recorded phone/WhatsApp sales **without an order** (the advertising
module's `ad_offline_sales`, 0154) are not orders and are not in this report.

## 4. Weekly channel report

`/admin/measurement/channel-report` (`attribution.read`): weeks start Monday
00:00 Kampala; 4–52 weeks; model switcher; per channel credited orders,
revenue, spend, ROAS (revenue ÷ spend), cost per order (spend ÷ credited
orders), weekly revenue trend line; weekly totals; creators and promo codes by
name next to the ads. CSV: `/api/admin/attribution/channel-report.csv`
(formula-safe cells; empty values are written as "No spend data" / "No data",
never 0). Recompute (`settings.manage`, reason required, audited as
`ATTRIBUTION_RECOMPUTED`).

**Spend** comes from the one canonical media-spend table, `media_cost_facts`
(0102), which the advertising module fills (platform import or CSV, 0154).
`spend_minor + tax_or_fee_minor`, **UGX rows only** (other currencies are named,
not converted). Spend is filed under the channel its clicks land in: every
Google/Microsoft Ads click carries a gclid/msclkid, which the landing
classifier files as paid search whatever the campaign type, so all Google and
Microsoft spend is `paid_search`; Meta/TikTok/Snap/Pinterest/LinkedIn/X is
`paid_social`. No UGX spend row in the window → "No spend data" everywhere.

## 5. What the owner fills in

- **No new environment variables and no credentials.** This module makes no
  external call.
- Spend: import it on `/admin/advertising` (advertising module).
- Creator codes: assign the coupon to the creator (`coupon_codes.assigned_to_creator_id`)
  so its sales show as the creator, not as a plain promo code.
- Staff: when a sale is closed in WhatsApp, paste the `Ref GP-…` from the chat
  on the order page.

## 6. Known limits

- A visitor who clears cookies or switches device is a new visitor; no
  cross-device stitching is attempted (identity links are not used here).
- `fbclid` alone is classified as paid social by `classifyChannel` (0141). Meta
  also adds it to organic outbound links, so organic Facebook traffic may be
  over-credited to paid social. Left unchanged here; noted for the classifier.
- Credited orders under linear/time-decay/position-based are fractional.

Sources: WhatsApp click to chat (`wa.me/<number>?text=<urlencodedtext>`):
https://faq.whatsapp.com/5913398998672934
