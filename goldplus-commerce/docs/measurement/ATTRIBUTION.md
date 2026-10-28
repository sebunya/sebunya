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
   us?". Used in the journey **only when there is no observed touch with a source and no code** (a journey of only direct visits counts as none, v2),
   and marked `basis = 'declared'`. Ambiguous answers stay ambiguous:
   "Facebook" is `social_declared`, never paid social. Two answers are
   staff-only (`walk_in`, `phone_call`; the checkout never offers or accepts
   them): they are the offline-order rule, filed as `shop_floor` and
   `phone_order`, the order's own channels, never "direct" and never spread
   (docs/measurement/MMM_AND_INCREMENTALITY.md §8).

**Direct visits (channel-credit-v2, 2026-10-29).** "Direct" means no evidence (a typed address, a bookmark, the
installed app), and nearly every customer comes back that way to pay. Under v1 a shopper who found a guide on Google
and came back two days later by typing the address was filed 100% Direct under Last click, so search, social,
WhatsApp and the YouTube placements were buried under the one channel that explains nothing (the test even pinned
it). v2 applies GA4's rule to every model: direct visits are dropped while anything else was recorded; a journey of
only direct visits gives way to the customer's answer when there is one (basis `declared`), and is Direct otherwise.

Models (`measurement.order_channel_credit`, one row per order × model ×
channel × detail, with weight and integer UGX credit; `model_version =
channel-credit-v2`): `last_click`, `first_touch`, `linear`, `time_decay`
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

- Cross-device: an order is linked to its own browser's visits and to every other browser the identity graph (0155)
  ties to the same customer (`link_method = 'stitched'`), plus a chat's visitor through its WhatsApp reference. A
  guest who never signs in, verifies a phone or orders twice on two devices stays two visitors.
- A visit is one landing touch per tab session (more only when a new campaign, click id or outside referrer arrives);
  what the visitor does after landing is not a touch.
- Credited orders under linear, time-decay and position-based are fractional.
- Organic search is filed from the referrer (or Google's `srsltid` marker when the referrer is missing); which
  query was typed is Search Console's to tell, not ours.

## 7. Classifier notes (2026-10-29)

`domain/measurement/Channels.ts`, fed by the one rulebook `packages/shared/src/attribution/arrival.ts`:

- Webmail and mail apps (`mail.google.com`, the Gmail app's `com.google.android.gm`, Yahoo Mail, Outlook, Proton)
  are `email`. They used to read as Google or Yahoo **search** (or "referral" for Outlook).
- AI assistants include Grok, Mistral, Poe, You.com, Phind, Copilot (cloud.microsoft) and the ChatGPT and Perplexity
  Android apps.
- Google's `srsltid` (its marker on organic results of Merchant Center sites) on a referrer-less, untagged visit names
  google.com: organic search, and GA4 is told the same. Never an ad (gclid decides first) and never a stored click id.
- A radio, TV, podcast or paper placement's link (`utm_medium=placement`) is `offline_media`; it used to fall to
  `other`, so the placement scorecard showed no arrivals. A placement's promo code credits the placement published
  on or before the order day, named by its link slug (the key its link visits use).
- Fixes reach the past: `apps/api/src/scripts/reclassify-attribution.ts` re-derives every recorded touch's channel
  from its recorded fields (an unchanged rule gives the same answer) and re-credits every order (dry run first; run
  at deploy; audited as `ATTRIBUTION_RECOMPUTED`).

## 8. Where sales started

The channel report's last table: each sale's entry page, the first recorded arrival with a source (a direct one only
when that was all), grouped by page × channel with section totals (`domain/measurement/EntryPages.ts`). First-party:
`measurement.touchpoint.landing_path` joined through `order_touch_link`, no GA4. It answers "which pages bring
customers who buy" (the organic programme's gate G5, `docs/growth/funnel-check.sql`).

## 9. Search events

A `search` (GA4 and the ad platforms' standard event) is counted only when a search form submitted that term
(`siteSignalRules.searchWasTyped`). The menu's pre-filled links (`/battery-finder?q=Tecno`,
`/shop?category=power&q=adapter`) and shared results links used to count as searches.

Sources: WhatsApp click to chat (`wa.me/<number>?text=<urlencodedtext>`):
https://faq.whatsapp.com/5913398998672934

## YouTube channels (2026-10-24)

The shop buys placements on YouTube channels and pays the channel, not YouTube. Channel `youtube` is its own key: a visit tagged `utm_source=youtube` without an ad medium (each placement's description link, detail = the placement slug) or referred by youtube.com, an order redeeming the promo code recorded on a placement (detail = "outlet: title"), and the checkout answer "A YouTube video" (`heard_about = youtube`) all file there, beside the placement's cost from `media_placements` (0206). Never `organic_social` or `paid_social`. See MMM_AND_INCREMENTALITY.md §4a.
