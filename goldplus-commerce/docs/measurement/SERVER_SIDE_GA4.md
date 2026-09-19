# Server-side GA4 (live since 2026-09-19)

| Piece | Value |
|---|---|
| GTM account | GoldPlus (6377806000) |
| Web container | GTM-PS424MV3 — Google tag G-YVV0KLGMQJ (`server_container_url` = https://metrics.shopgoldplus.com, `client_id` = dataLayer `fp_client_id`), GA4 Event tag on the 8 ecommerce events (ecommerce from the dataLayer) |
| Server container | GTM-P5VKZN7V — clients: GA4, GTM Web Container (serves gtm.js for GTM-PS424MV3); tag: GA4 → G-YVV0KLGMQJ on "Client Name = GA4" |
| GA4 property | ShopGoldPlus 549232812, stream 15408433033, G-YVV0KLGMQJ |
| Tagging server | `sgtm-production` (compose), public at metrics.shopgoldplus.com via Caddy (CF-Connecting-IP forwarded) |

## Policy (OWNER DECISION 2026-09-19)
Server-side analytics is **always on**, for every visitor, including browsers sending "do not track"/GPC.
IP address and browser details are kept on our servers and not deleted. The preference-centre switch governs
analytics **cookies in the browser** only (Consent Mode `analytics_storage`), and its wording says so; the
privacy (#analytics) and cookies pages state all of this. Supersedes the 2026-08-07 "analytics off by default" rule.

## Flows
- **Page views:** the web container (GTM-PS424MV3, loaded first-party from metrics.shopgoldplus.com) → tagging
  server → GA4. Robots (webdriver/headless/Lighthouse) never load it.
- **Ecommerce events** (view_item_list … add_payment_info): the browser beacons them to OUR API
  (`/telemetry/collect/batch`), which records them first-party with the real IP/UA and the GA4 session read from the
  `_ga_<stream>` cookie, and sends each to GA4 server-side (`/g/collect` on the internal tagging server). Survives ad
  blockers; no cookie dependency. The web container's GA4 event tag is PAUSED (version 4) — never un-pause it, or every
  event counts twice.
- **Purchase / refund:** server only. Purchase on PesaPal confirmation or explicit COD placement; refund once when an
  order whose purchase was SENT is cancelled (an unsent purchase is withdrawn instead).
- **Real client IP:** Caddy `{client_ip}` = CF-Connecting-IP, believed only from Cloudflare's published ranges
  (global `trusted_proxies`); all vhosts forward it as X-Forwarded-For / X-Real-IP.
- **CSRF:** `CSRF_ALLOWED_ORIGINS` must include the storefront origins. GA's `_ga` cookies are domain-wide, so every
  beacon to api.shopgoldplus.com carries a cookie; without the allowlist every one was refused (403).

## Env (.env.production)
`GA4_MEASUREMENT_ID`, `GTM_CONTAINER_CONFIG` (server container config string), `PUBLIC_GTM_ID`,
`PUBLIC_METRICS_URL` (the last two are web BUILD args). `GTM_HMAC_SECRET` is no longer used by dispatch.

## Not done
- Preview is live at preview-metrics.shopgoldplus.com (`sgtm-preview`; production's PREVIEW_SERVER_URL).
- The web-container client's custom tag-serving path (ad-blocker resistance) is not used yet: every form tried
  returned 400; the page still loads /gtm.js.
- No advertising destinations (Google Ads, Meta CAPI) are connected; ad consent stays denied until they are.
