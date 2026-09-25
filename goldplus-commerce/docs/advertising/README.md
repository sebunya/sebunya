# Advertising operations (migrations 0154, 0158, 0159)

Admin: `/admin/advertising` (connection checklist + conversions), `/admin/advertising/audiences`,
`/admin/advertising/spend`, `/admin/advertising/offline`. API: `/admin/advertising/*` (settings.manage).
Public feeds: `/advertising/feeds/meta-catalogue.csv`, `/advertising/feeds/tiktok-catalogue.csv`.

Everything here is **inert until the owner configures it**. A capability that is not LIVE answers
"Not configured" and makes no network call. Tokens are write-only (vault-encrypted, masked, never
returned or logged; error messages are scrubbed of them). Production state when this was built:
0 ad destinations configured, so nothing is sent.

## Rules this module keeps

- **No fake integrations.** Every call below is the platform's documented API (sources at the end).
- **Consent.** Every customer list, offline conversion and conversion uses the one advertising
  predicate (`AdvertisingConsentGate.isStoredAdvertisingRefusal`, decision D-002): a stored
  refusal on the account, on any browser that placed the order, on any browser linked to the
  account (`identity_links`), or on any browser or account the first-party identity graph ties
  to the order's customer (`customer_identity_links`, 0155: the order's
  `ORDER_CUSTOMER_RELATIONSHIP` link → its canonical customer → every `fp:` visitor link and the
  profile's account) excludes the person. The last one is what covers guest buyers:
  `order_attribution` keeps a browser for only a minority of orders. A failed consent read
  sends nothing.
  Server-side tracking itself stays always on (owner decision D-001).
- **Hashing.** SHA-256 hex after each platform's documented normalisation
  (`domain/advertising/ContactNormalisation.ts`):
  Google: email trimmed + lower-cased, gmail/googlemail dots and `+suffix` removed; phone E.164
  with `+` (Data Manager API formatting rules; hex encoding). Meta: email trimmed + lower-cased; phone digits with country code, no `+`.
  TikTok: email trimmed + lower-cased; phone E.164 with `+`. Admin-recorded sales store only the
  hashes, never the plaintext contact. The first-party module's audience hashing
  (`domain/first-party/AudienceHashing.ts`) delegates to the same functions, so one customer
  always hashes to the same value.
- **Never invent data.** Empty reports say "No data"; unknown clicks/impressions are null (a
  dash), never 0; totals are per currency, never across currencies.

## 1. Connection checklist

`GET /admin/advertising/checklist` builds, per platform, every field with where to find it in the
platform's own screens and its live status, from real state (`ad_destinations`,
`ad_destination_capabilities`, the public catalogue). Statuses: Not configured / Configured
(switched off) / **Test** / **Live**; catalogue: Ready when products qualify. A step done inside
the platform (scheduling a feed) cannot be observed and is shown as such, never ticked.

Test mode (`ad_destinations.mode = 'test'`) exists only where the platform documents a test
channel: Meta and TikTok (`test_event_code`, required before Test can be chosen), Google Ads
(`validateOnly`), Pinterest (`?test=true`). Test sends still carry real shoppers' hashed data, so
a Test platform is listed as a recipient on the privacy page.

## 2. Catalogue feeds (Meta, TikTok)

Built from `seoGrowthRepo.feedProducts()` with the Google feed's `isFeedIncluded` (eligible,
active, approved, priced, described, photographed; sample frames are never in the image list).
Only the public price; never a dealer price, supplier cost or floor; availability as a word, never a
unit count (no `quantity_to_sell_on_facebook`).

- Meta CSV columns: `id,title,description,availability,condition,price,link,image_link,brand,additional_image_link,sale_price,sale_price_effective_date,google_product_category,product_type,mpn`.
  Availability `in stock` / `out of stock` (a pre-order without a date goes out of stock, as in
  the Google feed). Sale price only with its real window.
- TikTok CSV columns: the nine required (`sku_id,title,description,availability,condition,price,link,image_link,brand`)
  plus images, categories, MPN. `preorder` is a TikTok value and is used. No sale price: TikTok's
  field list has no effective-date field to end it.

## 3. Audiences

Segments from real orders (`domain/advertising/AudienceSegments.ts`), a buyer being a person
(orders sharing account, email or phone are one person); a qualifying order is delivered/completed
or paid and not cancelled/failed.

| List | Rule | Google membership |
|---|---|---|
| Past buyers | everyone who bought | 540 days |
| Recent buyers (exclusion) | bought in the last N days (default 30) | 30 days |
| High-value seed | lifetime spend ≥ owner threshold, else top 20% (ties kept) | 540 days |

**Owner-defined segments** (0158): the segments defined under `/admin/segments` (first-party
module, 0155) can be ticked per platform (`customSegments`, up to 10 keys). Each becomes its own
list (slot `seg:<key>`, 540-day membership). They are read ONLY through the first-party
segment → audience port (`ISegmentAudienceSource.advertisingAudience`), which re-checks consent
per member at read time (refused or unreadable = left out) and returns hashes only. A segment
not yet computed says so ("NOT_MATERIALISED"); an archived or deleted one has its list emptied.

Daily after 03:00 Kampala each LIVE platform's selected lists are **fully replaced**: Google
(Data Manager API) `audienceMembers:ingest` for everyone (see "Google confirms later" below);
Meta `usersreplace`; TikTok `update` with `action: REPLACE`. A list with nobody eligible left, or
a list the owner stopped selecting, is emptied (Google `audienceMembers:removeAll`; Meta/TikTok
audience deleted), so it never keeps someone who has since refused. Meta's token travels in the
`Authorization: Bearer` header on every Graph call (never in a URL, including Insights paging
`next` URLs, whose `access_token` parameter is stripped). TikTok refuses customer files under
1,000 entries: such a list is reported as TOO_SMALL and not sent. The TikTok file here is
phone-only (one identifier type per file). Admin shows the dry-run counts (in segment, refused,
no identifier, would upload) and every run is kept in `ad_audience_runs` (insert-only; 0159 adds
confirmation columns that are filled later, the run's recorded columns are never rewritten).

**Schedule (0159).** Each platform's daily audience sync and spend import is its own job in
`ad_job_claims` (`advertising-daily:<day>:<capability>:<platform>`), held under a lease. It is
marked done only when it succeeded; a failure (platform or database error, unreadable consent,
a busy lock) is retried on a later 5-minute tick the same day, 20 minutes after the failure, at
most 3 attempts. **One sync per platform at a time:** a SYNC takes the lease
`ad-audience:<platform>` (30 minutes, released at the end); a run that cannot take it is logged
`BUSY` and makes no platform call, so an admin click during the scheduled run can never create a
second list and orphan the first.

**Google confirms later (0159).** Data Manager processes `audienceMembers:ingest` and
`:removeAll` asynchronously; the reply carries only a `requestId`, and the outcome (per
destination: `SUCCESS`, `PARTIAL_SUCCESS`, `FAILED`, `PROCESSING`) comes from
`GET https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=…`. So a Google run
is logged **SUBMITTED** with its request ids (`ad_audience_runs.remote_requests`), and admin
shows "Sent, waiting for Google". The 5-minute tick polls it (`AudienceSyncUseCases.confirmPending`,
`domain/advertising/AudienceConfirmation.ts`):
- every ingest `SUCCESS` → only then the stale-member sweep is sent: `audienceMembers:removeAll`
  with `removeAsOfTime` = the run's start (members last added before the run, i.e. not re-added
  by it, such as someone who since refused); its own request id is polled the same way →
  "Confirmed by Google";
- any `FAILED` → "Rejected by Google" with Google's error counts; nothing is removed;
- `PARTIAL_SUCCESS` → "Partly accepted by Google"; the sweep is **not** sent (after an incomplete
  upload it could remove people who are still eligible); the next daily run tries again;
- still processing after 48 hours → "Not confirmed by Google" (never counted as a success).

**Unconfirmed platform behaviour — check before relying on it.** Google documents that
`removeAsOfTime` removes "only audience members last added before this time", but does **not**
document whether re-ingesting a member who is already on the list refreshes that "last added"
time. If it does not, the sweep after every run would remove every member who was already on the
list, and the list would shrink to the people added for the first time that day. Before the owner
relies on Google lists, check it on a **test list**: create a list with two test contacts you own,
run a sync, wait for "Confirmed by Google", run a second sync the next day, wait again, and check
in Google Ads (Audience manager → the list → size, or a Data Manager `requestStatus` of the
sweep) that both contacts are still members. If they are not, switch Google audiences off and
report it; do not rely on Google lists until it is resolved.

**Google Customer Match runs on the Data Manager API.** Since 1 April 2026 Customer Match
requests through the Google Ads API (`OfflineUserDataJobService`, `UserDataService`) fail for any
Google Cloud project that had not sent Customer Match requests before; GoldPlus never had, so that
path was replaced before it ever ran. Lists are created with
`POST https://datamanager.googleapis.com/v1/accountTypes/GOOGLE_ADS/accounts/{customerId}/userLists`
(`ingestedUserListInfo.uploadKeyTypes: [CONTACT_ID]`, `contactIdInfo.dataSourceType:
DATA_SOURCE_TYPE_FIRST_PARTY`, `membershipDuration` in seconds); members are sent to
`audienceMembers:ingest` (≤ 10,000 per request, `userData.userIdentifiers` of `emailAddress` /
`phoneNumber`, `encoding: HEX`) with the destination `operatingAccount` = the Google Ads customer,
`loginAccount` = the manager account when one is entered, `productDestinationId` = the list id.
OAuth scope `https://www.googleapis.com/auth/datamanager`; the Data Manager API must be enabled in
the OAuth client's Google Cloud project. Spend import and offline click conversions stay on the
Google Ads API, which the change does not affect. The account must also meet Google's Customer
Match policy (good policy compliance and payment history).

- **Consent stance (Google):** no `consent` block is sent, neither per request nor per member. The
  shop stores refusals (anyone who refused is never uploaded) but no per-person grant for
  Google's `ad_user_data` / `ad_personalization`; the field is optional and required by Google
  only for EEA users, and the shop sells in Uganda. Declaring `CONSENT_GRANTED` for people who
  never recorded a grant would tell Google something that is not true.
- **Terms:** `termsOfService.customerMatchTermsOfServiceStatus: ACCEPTED` is sent only because
  the capability cannot be switched on until the owner ticks "Customer Match terms accepted in
  Google Ads" (accepted once in Google Ads > Audience manager > Customer list).

**Erasure (first-party privacy, 0157).** An erasure request suppresses the customer's waiting
offline conversions (`SUPPRESSED`, reason `ERASED`) and removes their ad click ids from
`order_attribution` in the same transaction. Their order contacts are blanked, so from then on
they are not in any computed list; **platform audience lists that already hold them are corrected
at the next daily audience sync** (the full replace, and for Google the confirmed sweep).

## 4. Spend

One table: `media_cost_facts` (0102), with `clicks`, `impressions`, `campaign_label` added.
API rows use the campaign **id** as the key (`id:<id>`) and the name as the label, so a renamed
campaign is not counted twice; a re-import of the same day replaces its figures (platforms revise
recent days; the daily import reads the last 7 days).

- Google Ads: `POST /{v}/customers/{id}/googleAds:searchStream` with
  `SELECT customer.currency_code, campaign.id, campaign.name, campaign.advertising_channel_type, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date BETWEEN …`.
  Cost micros → minor units of the account currency.
- Meta: `GET /act_{id}/insights?level=campaign&time_increment=1&time_range=…&fields=campaign_id,campaign_name,spend,impressions,clicks,account_currency,date_start`, paging followed.
- CSV (no API): header row; `date, platform, campaign, spend, currency` required;
  `channel, account, campaign_id, clicks, impressions` optional. Whole file checked first; all or
  nothing; one currency per file and matching the currency already held; rows for a platform whose
  API import is LIVE are refused (they would double count).

## 5. Offline conversions

Sources: COD orders confirmed on delivery (the authoritative `order_delivered` business event of a
`payment_method = 'offline'` order, not cancelled) and phone/WhatsApp sales recorded in admin.
One row per platform in `ad_offline_conversions`, unique on (platform, source, source ref):
idempotent. Every 5 minutes: queue, then send due rows (leased, so overlapping ticks never send
twice).

Deduplication against online events: decision D-006 sends a COD order's Purchase online at
placement. If that order's online purchase delivery for the platform is ACCEPTED/PROCESSED or still
PENDING/LEASED/RETRY_WAIT/UNKNOWN_OUTCOME/QUARANTINED, the offline row becomes
`DUPLICATE_ONLINE` and is not sent. When sent, a COD conversion carries the **same event id** as
the online purchase (the `order_confirmed` business event id) and the order number as order id,
so the platform's own dedupe also catches a race.

- Google Ads: `customers/{id}:uploadClickConversions` with the order's gclid/gbraid/wbraid when it
  kept one, and hashed email/phone (`userIdentifiers`, enhanced conversions for leads) otherwise;
  conversion action = the optional offline action id, else the conversions action. 90-day window.
- Meta: Conversions API `/{dataset}/events`, `Purchase`, `action_source` per Meta's documented
  values: COD hand-over `physical_store`, phone sale `phone_call`, WhatsApp chat sale `chat`.
  7-day window.
- TikTok: Events API `event/track`, `event_source: "offline"`, `event_source_id` = offline event
  set id, `CompletePayment`. 7-day window.

Non-production never sends (unless `MEASUREMENT_ALLOW_NONPROD_DELIVERY=true`, the DeliveryService rule).

## 6. Early signals

`generate_lead` joins the canonical events (GA4's recommended lead event). A tap on a WhatsApp
chat link to our number (counted on the pages that register the tap handler: product pages and
"bulk request sent"; never loaded by the every-page script, so the header's WhatsApp link on other
pages is not counted), or a sent quote request (bulk or classic form, once per reference per
device), is beaconed like add_to_cart and forwarded server-side with its event id. Mapping: Meta
`Contact` (WhatsApp chat tap) / `Lead` (quote request: details submitted); TikTok `Contact` (WhatsApp) / `SubmitForm` (quote); Pinterest `lead`; Microsoft
`generate_lead`. Each destination's optimisation events (`ad_destinations.event_selection`;
null = all supported) are chosen in admin; purchases are always sent.

## What the owner fills in

No new environment variable is required. The vault key is `SEO_CREDENTIAL_VAULT_KEY` (falls back
to `JWT_SECRET`); without either, tokens cannot be stored ("Not configured"). Optional:
`DISABLE_ADVERTISING_TICKER=1` stops the scheduler.

| Platform | Conversions (existing card) | Audiences | Spend | Offline |
|---|---|---|---|---|
| Google Ads | customer ID, conversion action ID (import/click), manager ID (optional), API version, JSON `{developerToken, clientId, clientSecret, refreshToken}` | enable the **Data Manager API** in the OAuth client's Google Cloud project; a **Data Manager refresh token** (one OAuth consent with that client for scope `https://www.googleapis.com/auth/datamanager`); tick "Customer Match terms accepted"; lists + window/threshold + your segments | uses the conversions credentials | optional offline conversion action ID |
| Meta | dataset ID, CAPI token, test event code (for Test) | ad account ID + system-user token (`ads_management`, `ads_read`); accept Custom Audience terms; lists + your segments | ad account ID (token optional: reuses the audiences token) | nothing extra |
| TikTok | pixel code, Events API token, test event code (for Test) | advertiser ID + Marketing API access token (Audience Management scope); lists + your segments | not built (no API import requested; use CSV) | offline event set ID (+ optional token) |

Catalogue: paste the feed URL into Meta Commerce Manager (Data sources → Data feed → scheduled URL)
and TikTok Catalogs (Add products → Data feed), daily.

## Sources (official documentation)

- Google Ads API Customer Match notice (Google Ads API uploads fail from 1 April 2026 for projects without prior Customer Match requests; migrate to the Data Manager API):
  https://developers.google.com/google-ads/api/docs/remarketing/audience-segments/customer-match/get-started
- Data Manager API, create a Customer Match audience (userLists.create): https://developers.google.com/data-manager/api/devguides/audiences/google-ads/customer-match/create-audience
  and https://developers.google.com/data-manager/api/reference/rest/v1/accountTypes.accounts.userLists/create
- Data Manager API, send audience members (ingest, ≤ 10,000 per request, encoding, termsOfService): https://developers.google.com/data-manager/api/devguides/audiences/send-audience-members
  and https://developers.google.com/data-manager/api/reference/rest/v1/audienceMembers/ingest
- Data Manager API, remove all members (removeAsOfTime; "only audience members last added before this time will be removed"): https://developers.google.com/data-manager/api/reference/rest/v1/audienceMembers/removeAll
- Data Manager API, request status (requestStatus:retrieve; SUCCESS / PARTIAL_SUCCESS / FAILED / PROCESSING per destination, error counts): https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve
  and https://developers.google.com/data-manager/api/devguides/diagnostics
- Meta Graph API access tokens (sent in the Authorization header, never a URL): https://developers.facebook.com/documentation/facebook-login/guides/access-tokens
- Meta standard events (Lead = details submitted, i.e. a quote request; Contact = a chat, call or email started, i.e. a WhatsApp tap): https://www.facebook.com/business/help/402791146561655
- Data Manager API destinations (operatingAccount / loginAccount / productDestinationId, login-account header): https://developers.google.com/data-manager/api/devguides/concepts/destinations
- Data Manager API formatting (email and phone normalisation): https://developers.google.com/data-manager/api/devguides/concepts/formatting
- Data Manager API access (scope https://www.googleapis.com/auth/datamanager, enable the API): https://developers.google.com/data-manager/api/devguides/quickstart/set-up-access
- Google Ads offline click conversions / enhanced conversions for leads: https://developers.google.com/google-ads/api/docs/conversions/upload-offline
- Google Ads reporting (searchStream, GAQL): https://developers.google.com/google-ads/api/docs/reporting/example
- Meta Custom Audiences (customer file, users, usersreplace, hashing): https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences
- Meta Insights API: https://developers.facebook.com/docs/marketing-api/insights
- Meta Conversions API server event parameters (action_source, event_id, 7-day event_time): https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
- Meta catalogue feed fields: https://developers.facebook.com/docs/commerce-platform/catalog/fields
- TikTok catalogue product parameters: https://ads.tiktok.com/help/article/catalog-product-parameters
- TikTok customer file requirements (E.164 phone, ≥1,000 entries): https://ads.tiktok.com/help/article/how-to-create-a-custom-audience-with-a-customer-file
- TikTok audience endpoints (dmp/custom_audience/file/upload, create, update): https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AudienceApi.md and https://business-api.tiktok.com/portal/docs/create-a-customer-file-audience/v1.3
- TikTok Events API for offline (event_source offline, offline event set): https://business-api.tiktok.com/portal/docs/events-api-for-offline/v1.3

Not verified against a live account (no credentials exist): the TikTok customer-file body layout
(one hash per line, no header), TikTok's `dmp/custom_audience/delete/` body, and the Data Manager
API end to end (request shapes follow its REST reference). Both surface a
platform error in the run log rather than failing silently.
