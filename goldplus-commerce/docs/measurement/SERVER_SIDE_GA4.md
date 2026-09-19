# Server-side GA4 (live since 2026-09-19)

| Piece | Value |
|---|---|
| GTM account | GoldPlus (6377806000) |
| Web container | GTM-PS424MV3 — Google tag G-YVV0KLGMQJ (`server_container_url` = https://metrics.shopgoldplus.com, `client_id` = dataLayer `fp_client_id`), GA4 Event tag on the 8 ecommerce events (ecommerce from the dataLayer) |
| Server container | GTM-P5VKZN7V — clients: GA4, GTM Web Container (serves gtm.js for GTM-PS424MV3); tag: GA4 → G-YVV0KLGMQJ on "Client Name = GA4" |
| GA4 property | ShopGoldPlus 549232812, stream 15408433033, G-YVV0KLGMQJ |
| Tagging server | `sgtm-production` (compose), public at metrics.shopgoldplus.com via Caddy (CF-Connecting-IP forwarded) |

## Flows
- **Browser events** (view_item … add_payment_info): dataLayer → web container (loaded first-party from
  metrics.shopgoldplus.com) → tagging server → GA4. Consent Mode v2 defaults are set in `BaseLayout.astro`
  before the container: analytics granted unless the browser sends Global Privacy Control; ads denied.
- **Purchase** (server only): an online order when PesaPal confirms payment (settlement effect), a cash-on-
  delivery order when placed. `queuePurchaseTelemetry` → outbox (`purchase:<order number>`, once per order) →
  `TelemetryDispatchService` → `http://sgtm-production:8080/g/collect` as a GA4 hit (`Ga4CollectHit.ts`),
  with `cid` = the visitor's `_fp_cid` captured at checkout (order_attribution, 0136) and the buyer's IP/UA.
  Browser-origin copies in the outbox are NOT re-sent (the web tag already sent them).

## Accuracy measures (2026-09-19, second pass)
- **Session stitching:** checkout reads GA4's `_ga_<stream>` cookie (GS1/GS2 formats, `lib/gaSession.ts`) into
  order_attribution (0137); the server purchase carries `sid`/`sct`/`seg`, so the sale is credited to the visit's source.
- **Refunds:** an order moving to `cancelled` whose purchase was sent gets one GA4 `refund` (`refund:<order number>`).
- **Consent:** the preference-centre analytics choice is mirrored into `gp_consent` (a0/a1) by /account/preferences;
  the page denies analytics_storage on a0 or Global Privacy Control, before GTM loads.
- **Durable visitor id:** `_fp_cid` is set by the web server (middleware), refreshed at most daily (`_fp_r`),
  so Safari's 7-day cap on script-set cookies no longer applies. Refreshing on every page would make HTML uncacheable.
- **user_id:** signed-in shoppers' id is pushed to the dataLayer; the Google tag sends it (`user_id` = DLV user_id).

## Env (.env.production)
`GA4_MEASUREMENT_ID`, `GTM_CONTAINER_CONFIG` (server container config string), `PUBLIC_GTM_ID`,
`PUBLIC_METRICS_URL` (the last two are web BUILD args). `GTM_HMAC_SECRET` is no longer used by dispatch.

## Not done
- Preview is live at preview-metrics.shopgoldplus.com (`sgtm-preview`; production's PREVIEW_SERVER_URL).
- The web-container client's custom tag-serving path (ad-blocker resistance) is not used yet: every form tried
  returned 400; the page still loads /gtm.js.
- No advertising destinations (Google Ads, Meta CAPI) are connected; ad consent stays denied until they are.
