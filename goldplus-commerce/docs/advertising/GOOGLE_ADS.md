# Google Ads — advanced setup (2026-10-16)

Server to server, no browser tag (owner rule: ecommerce events go server-side only). Everything below is built and
tested; nothing is sent until the Google Ads card on `/admin/advertising` is saved and switched on.

## What reaches Google

| Signal | When | How |
|---|---|---|
| **Purchase** | an order is confirmed (paid online) | Data Manager `events:ingest` → the purchase action (UPLOAD_CLICKS). Value in **UGX** (Google lists UGX). `transactionId` = order number. |
| **Refund** | money goes back (partial or full) | the **same** transaction restated with the value kept (0 for a full refund) — a conversion adjustment; Google overwrites the value, so a repeat is harmless. Only after the purchase reached Google. |
| **Lead** | quote request, WhatsApp tap | the optional lead action, no value. |
| **Phone / WhatsApp sale** | recorded on `/admin/advertising/offline` | `eventSource` PHONE or MESSAGE, matched by the customer's click id or hashed contact. |
| **New vs returning** | every purchase | `userProperties.customerType`: NEW when there is no earlier paid or delivered order by the same account or phone. Turn on **new customer acquisition** in the campaign to bid for it. |
| **Products** | every purchase | `cartData` items with `merchantProductId` = SKU = the Merchant Center feed's `g:id` (`/seo/merchant-feed.xml`), plus the Merchant Center ID when saved. |
| **Matching** | every event | gclid / gbraid / wbraid (captured from the landing URL, kept 30 days, stitched to the visitor and the order); hashed email and phone (Google's normalisation; phone E.164 with `+`) = **enhanced conversions for leads**; the visitor's IP and browser as a last resort. |
| **Customer Match** | daily | already on the Data Manager API (`/admin/advertising/audiences`). |
| **Spend** | daily, optional | Google Ads API `searchStream` — needs a developer token (the only part that does). |

Consent: a stored advertising refusal (account, browser or linked identity) stops every send (D-002). Uganda is
outside the EEA's consent-mode rules; no per-event consent block is sent.

## Owner steps (once)

1. **Google Ads**: turn on **auto-tagging** (Admin > Account settings > Auto-tagging) so ad clicks carry a gclid.
2. **Conversion actions**: Goals > Conversions > New conversion action > Import > *CRM, files or other data sources* >
   *Track conversions from clicks*:
   - "Purchase (server)": category Purchase, value *Use different values*, count *One*, click-through window 90 days.
   - "Lead (server)" (optional): category Submit lead form, *Don't use a value*, count *One*.
   Turn on **Enhanced conversions for leads** (Goals > Settings). Note each action's ID (`ctId=` in its URL).
3. **Google Cloud** (the project where *Data Manager API* is enabled): IAM & Admin > Service accounts > Create
   ("goldplus-ads"), no roles needed; Keys > Add key > JSON → a file downloads.
4. **Google Ads access**: Admin > Access and security > + > the service account's email
   (…@….iam.gserviceaccount.com), **Standard** access.
5. **`/admin/advertising` > Google Ads**: customer ID `9161339749`, the purchase (and lead) action IDs, the Merchant
   Center ID if any, and paste the JSON key file as the credentials. Save in **Test** first: Google validates
   (`validateOnly`) and records nothing; the activity page shows the result. Then switch to **Live**.
6. In the campaign: goal = the "Purchase (server)" action; optionally *new customer acquisition*.

Spend import (optional): add `"developerToken": "…"` to the JSON (manager account > Tools > API Center; basic access
is approved by Google) and an API version (e.g. `v22`).
