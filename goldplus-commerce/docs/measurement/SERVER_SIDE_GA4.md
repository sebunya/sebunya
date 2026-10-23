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
  server → GA4. Robots (webdriver/headless/Lighthouse), our probes and staff never load it.
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

## Attribution rules (audit 2026-10-23: 94.6% "Direct", 562 of 1,306 users neither new nor returning)
- **A server event reaches GA4 only inside a GA4 visit** (`ga_session_id` from `_ga_<stream>`), and only from
  production. Without one GA4 counted a user with no session and no source. Our own records and the ad platforms
  still receive every event (TelemetryDispatchService). Purchases and refunds are unchanged (DeliveryService).
- **The browser holds its beacons for that cookie**, up to 10 s; leaving the page sends them at once (lib/telemetry).
- **The tag loads at the first touch, key or scroll**, or after load + idle, whichever is sooner (BaseLayout).
- **A landing the tag never saw is handed on**: its campaign and click ids are put on the next page's URL and its
  referrer is set with `gtag('set', {page_referrer})`, until GA4 has seen the visit (sessionStorage `gp_land`,
  `gp_ga_seen`). Checked in Chrome against the live container (hits blocked): `dr` and `dl` carried, `_fv`/`_ss` set.
- **Our own links are tagged** `?ch=<channel>.<campaign>` (packages/shared/src/links/shopLinkTag.ts), which the page
  turns into utm_*: s SMS (sms/sms), w WhatsApp (whatsapp/chat), e email (goldplus/email), m Messenger, i Instagram
  (…/chat), a the installed app (app/pwa). Campaign = where the link goes (track, review, gift, loyalty, reset, pay,
  product, shop) or `goldie` for Goldie's replies. An SMS is tagged only if it costs no extra part. Referral links
  (`/r/<code>`) and the gift card share link carry utm_source=customer_share / customer_invite, utm_medium=friend.
- **Redirects keep the query** (lib/carryQuery): recorded redirects, a product's successor, /quotes, /consent, 404.
- **Not counted:** staff (any browser that opened the admin carries `gp_staff`; delete that cookie to be counted
  again), our probes (GoldPlusSyntheticProbe UA or `gp_probe`), declared automation.

## Env (.env.production)
`GA4_MEASUREMENT_ID`, `GTM_CONTAINER_CONFIG` (server container config string), `PUBLIC_GTM_ID`,
`PUBLIC_METRICS_URL` (the last two are web BUILD args). `GTM_HMAC_SECRET` is no longer used by dispatch.

## Not done
- Preview is live at preview-metrics.shopgoldplus.com (`sgtm-preview`; production's PREVIEW_SERVER_URL).
- The web-container client's custom tag-serving path (ad-blocker resistance) is not used yet: every form tried
  returned 400; the page still loads /gtm.js.
- No advertising destinations (Google Ads, Meta CAPI) are connected; ad consent stays denied until they are.
