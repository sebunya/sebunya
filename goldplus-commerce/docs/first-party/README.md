# First-party data and Customer DNA

Migrations **0155** (`0155_first_party_data.sql`) and **0157** (`0157_first_party_privacy.sql`).
Both are additive. Nothing is dropped, and no existing row is rewritten.

This module covers:

- identity resolution: one customer across their account, contacts, orders and browsers;
- the Customer 360 profile, its traits and its timeline;
- segments, and the port that advertising and messaging read them through;
- next-best action, read from the real profile;
- privacy: export, anonymisation and deletion;
- WhatsApp marketing consent;
- the value reports (LTV, repeat purchase, cohorts);
- the exclusion of our own traffic from analysis;
- phone hygiene.

## Rules that hold everywhere

- **Deterministic keys only.** Records are linked by the account id, a verified phone, an email, the order itself, and the server-issued visitor ids (`xp:` experience profile, `fp:` `_fp_cid`). Names, addresses, devices and "looks similar" never link anything.
- **Contacts are hashed before they become keys.** Emails and phones are normalised, then HMAC-SHA256'd with `IDENTITY_HASH_PEPPER`. A raw contact never lands in `customer_identity_links`. Without the pepper, contact links are skipped (`HASHING_NOT_CONFIGURED`). There is no weaker fallback hash.
- **Conflicts go to a person. They are never merged automatically.** A typed phone or email that another customer already holds becomes a row in `customer_identity_conflicts` (*Admin → Identity conflicts*). Only a *verified* proof can fold a guest profile into an account: a phone with `phone_verified_at`, or an email the identity provider verified. Two accounts are never merged here.
- **Behaviour only within consent.** Visitor ids are linked as behaviour only when the person has not refused personalisation. If the consent answer cannot be read, nothing is linked. A refused browser is still recorded in `customer_consent_anchors` (0157), for consent enforcement only. That way a refusal stored on that browser keeps the customer out of advertising audiences and messaging, and guest buyers are covered too. Anchors are never read for profiling. When a guest profile is folded into another, or a conflict resolution moves a link to another profile, the anchors are copied to the new profile in the same transaction, so the refusal follows the person (an anchor only ever excludes).
- **Honest numbers.** A rate over nobody is `null` ("No data"), never 0%. A future cohort month is `null`. A trait with no evidence says why. An **estimate** is labelled *Estimate*. Nothing predicted is shown as fact.

## Identity resolution (switched on; the owner approved)

`StitchCustomerIdentityUseCase` runs fire-and-forget at these moments. It never fails the caller.

| Moment | Where | Keys |
|---|---|---|
| Sign-in | `routes/auth.ts` `/login` | account |
| Registration | `routes/auth.ts` `/register` | account |
| Social sign-in | `routes/auth-social.ts` | account, plus the provider-verified email |
| Visitor link | `routes/recommendations.ts` `/profile/link` | account, experience profile, `_fp_cid` (within consent) |
| Order placed (checkout) | `routes/commerce.ts` `/orders/create` | account, the typed email and phone, the order, visitor ids |
| Phone verified (OTP) | `routes/account.ts` `/phone/verify` | account, plus the now-verified phone (the proof that folds that person's guest orders) |
| Nightly backfill | `FirstPartyNightlyTicker` | historical orders not yet linked |

For each account it also uses the account's phone: VERIFIED when verified, CONTACT otherwise. It uses the account's email as CONTACT, or as VERIFIED after a social sign-in.

Rollback: `IDENTITY_STITCHING=off`. The request paths and the nightly backfill both stop linking; segments still materialise.

## Customer 360

The admin page is **`/admin/customer-360/<canonical id>`**. You can also reach it from *Customer DNA*, and from *Customers → Customer 360*, which resolves by account.

The API is `GET /admin/first-party/customers/:id/360`. It needs the **`customer_data.view`** permission.

**Every view is audited.** The audit row (`CUSTOMER_PROFILE_VIEWED`, entity `customer_profile`) is written *before* any data is returned. If the audit row cannot be written, nothing is shown. The Customer DNA detail (`GET /admin/customer-dna/:id`) is audited the same way.

**One profile draws on these sources** (`DrizzleCustomer360Reader`):

- the account, and its phones and emails;
- identity links, masked on the server, including visitor ids and browsers;
- guest profiles folded in, and open conflicts;
- orders and their lines;
- baskets;
- bulk quotes (`quote_requests` plus `quote_request_lines`, matched by hashed contact);
- the loyalty balance;
- support tickets;
- messages (`notification_attempts` for their orders, quotes, tickets and account);
- landing visits (`measurement.touchpoint`, customer traffic only);
- category views (`recommendation_events`, with our own exhaust excluded);
- consents (`consent_current_state` for the account and browsers, and `customer_consent_states` purposes);
- attribution from the attribution module (`measurement.order_channel_credit` and `measurement.order_source_report`);
- battery requests (matched by hashed phone);
- product-finder sessions;
- segment membership;
- privacy requests.

**Traits** (`domain/first-party/CustomerTraits.ts`). Each one carries a basis:

| Trait | Basis | How |
|---|---|---|
| RFM score | Calculated | Quintiles among customers who have ordered: recency and frequency from counted orders, monetary from paid or delivered spend (`domain/customer-dna/Rfm.ts`). No order means no RFM. |
| Categories bought | Calculated | Share of spend by category across order lines |
| Categories browsed | Recorded | Product and category views on linked browsers |
| Brands bought | Calculated | Share of spend where the product's specifications name a brand |
| Phone owned | **Estimate** | LIKELY if they asked for a battery for that phone (a battery-finder request, matched by hashed phone), or bought a battery listed for exactly one phone. POSSIBLE if a bought battery fits several phones. Battery-finder searches themselves (`battery_finder_events`) carry only a hashed finder session, so they are not linked to anyone. |
| How their orders came | Calculated | The most common source per order: last click, else their own answer, else a WhatsApp reference |
| Payment habit | Calculated | Cash on delivery (`offline`) against online (`pesapal`). Two thirds or more one way sets the habit; otherwise "both". |
| District | Recorded | The most common delivery district. Falls back to the saved address, marked *Customer said*. |
| Bulk buyer | Recorded | A `BQ-` bulk quote linked by contact |
| Offers switched on | Customer said | `whatsapp_marketing` and `marketing_offers_campaigns` grants |
| What they told the product finder | Customer said | Category, problem, priority and budget answers |

**Value** is shown as lifetime value (paid or delivered orders), order count, AOV, time to second order and points balance.

**The timeline** lists visits, baskets, orders, quotes, messages, support tickets, consents, finder use and privacy requests, newest first. Every entry is a recorded row.

## Segments (0155; 0157 adds three rule kinds)

Segments are set up in *Admin → Customer segments* (`/admin/segments`).

Rules:

- bought in a category;
- abandoned basket;
- lifetime spend;
- bulk buyer;
- repeat buyer;
- lapsed;
- **RFM segment**, **payment habit** and **district** (added in 0157).

Segments match ALL or ANY of their rules. The page shows a preview count before saving. Membership is materialised nightly, between 02:00 and 06:00 Kampala time, or with *Recalculate now*.

**The port is `ISegmentAudienceSource`.** It is the only way advertising and messaging read a segment. Consent is applied per member every time:

- **Advertising.** The stored advertising refusal is checked (D-002) with the same rule as the built-in advertising lists (`refusedAmong`): by account, by every browser with no cap, by every browser linked to the account (`identity_links`), and including the consent anchors. It is read in ONE query per 500 members, not one per member. An unreadable answer excludes the whole chunk. Contacts are hashed through `domain/advertising/ContactNormalisation.ts`. `domain/first-party/AudienceHashing.ts` delegates to it, so there is exactly one set of hashing rules.
- **WhatsApp messaging.** A member is included only when `whatsapp_marketing` is granted for the number that is on the account today. Guests cannot have opted in.

The advertising audience sync consumes the port through the capability field `customSegments`. See `docs/advertising/README.md`.

## Next-best action

`POST /admin/customer-dna/:id/nba` runs `DecideNextBestActionUseCase`. The context is read from the real records (`DrizzleNbaContextReader`), not from placeholders:

- marketing consent per channel, with WhatsApp checked through its own gate;
- open support tickets;
- open fraud cases on their orders;
- products bought in the last 30 days, and whether they are out of stock;
- messages sent in the last 7 days. From 3 messages, the frequency cap applies.

If the message count cannot be read, the cap is treated as reached. With no marketing consent, marketing actions are excluded. The response lists what was not chosen, and why.

## Privacy

Customers go to **`/account/privacy`** ("Your data" in the account menu). The API is `/account/privacy/*`, and the customer must be signed in.

- **Download my data.** A JSON file, prepared at once. It covers the account, addresses, orders and items, how they found us, quote requests, battery requests, points, support tickets, consent choices and history, messages about their orders, product-finder answers, identity records (kinds only, never keys), segments and privacy requests. It never contains supplier cost, fraud cases or staff notes. The download is recorded as an `EXPORT` request and audited (`PRIVACY_EXPORT_SERVED`), and is limited to 5 a day.
- **Remove my details from past orders** (`ANONYMISE_HISTORY`), and **Delete my account** (`DELETE_ACCOUNT`). Both are received as requests, and the customer can withdraw them.
- A repeated submission (the same idempotency key) returns the first request. The key is stored scoped to the customer and the kind of request (a SHA-256 of `userId:kind:key`), so one customer's key can never collide with another's, and reusing a key for a different kind creates that kind's request.

Staff handle requests at **`/admin/privacy-requests`**. This needs the **`privacy_requests.manage`** permission. A person either:

- carries the request out, by typing its reference and saying how it was checked; or
- declines it, with a reason the customer sees.

Every step is audited. An order that is still open blocks the erasure, because the delivery needs the contact. The erasure and the status change run in one transaction.

**Both kinds** remove:

- from orders: the name, phone, email, address text and precise location. The district, amounts, items and statuses stay, because sales records are kept.
- from order attribution: the IP address, browser, browser id and ad click ids (gclid, fbc, ttclid …);
- offline conversions still waiting to be sent for their orders or their admin-recorded sales: suppressed (`SUPPRESSED`, reason `ERASED`), never sent. Platform audience lists that already hold them are corrected at the next daily audience sync;
- from matched quote requests and battery requests: the contact details. They are matched in SQL with no row limit (email lower-cased and trimmed; phone by its digits in every spelling), plus a paged scan against the customer's keyed identity hashes, so nothing is left behind while the request says COMPLETED. The export finds them the same way;
- from support tickets: the description;
- from the message log and the outbox payloads for their orders: the recipient;
- from ad offline-sales rows: the contact hashes;
- all contact and browser identity links.

**Delete account** also closes the account:

- the email is replaced with an undeliverable `@erased.invalid` address;
- the phone, password, birthday and referral code are removed;
- saved addresses are blanked and marked deleted;
- every session is revoked.

Some records are **kept**:

- **Consent records**, as evidence of what was agreed.
- **Consent anchors** (`customer_consent_anchors`). They hold browser ids only, and exist only to keep enforcing a refusal; after `ANONYMISE_HISTORY` the account stays open and its refusal must still apply.
- **Dealer applications.** These are business records, handled by support.
- **Pseudonymous telemetry keyed by a browser id** (server-side tracking is always on, by owner decision). Once the links are deleted it no longer connects to the person. **Open owner decision:** whether erasure should also purge that telemetry.

## WhatsApp marketing consent (0155)

WhatsApp marketing is a separate purpose, `whatsapp_marketing`, on the `whatsapp` channel:

- It is **off by default**. No row means not opted in.
- Opting in is **explicit**: the customer ticks a confirmation box in the preference centre (`/account/preferences`).
- Only a signed-in, verified account can hold a grant. A database CHECK enforces this.
- Each change records **evidence** in `consent_event_evidence`: the copy version and its hash, how it was confirmed, the hashed phone, IP and browser, and the surface.
- The grant covers the number that was opted in. If the account's phone changes, messaging stops until the customer opts in again.

Transactional messages never read this gate.

## Reports (0155)

*Admin → Customer value* (`/admin/customer-value`) shows LTV, repeat rate, the median time to second order, orders per customer, and cohort retention by first-order month (Kampala time).

The page also shows identity coverage: linked orders out of all orders. An LTV computed over half the orders is not an LTV. Empty states say "No data".

## Our own traffic, excluded from analysis (reversible)

`analysis.traffic_exclusion_marks` marks rows written by our own synthetic monitor, Lighthouse, smoke tests and cookieless SSR renders. Reports read the `analysis.*_human` views, or use `humanTrafficOnly()`. **No source row is updated or deleted.**

```
npx tsx src/scripts/exclude-internal-traffic.ts                          # dry run (default)
npx tsx src/scripts/exclude-internal-traffic.ts --apply
npx tsx src/scripts/exclude-internal-traffic.ts --revert=<run id>         # dry run of the undo
npx tsx src/scripts/exclude-internal-traffic.ts --revert=<run id> --apply # undo
```

Rollback without touching the marks: `ANALYSIS_EXCLUSIONS=off`.

## Phone hygiene

```
npx tsx src/scripts/phone-hygiene.ts                          # dry run (default): plan + proposed merges
npx tsx src/scripts/phone-hygiene.ts --apply                  # formats only, to +256…, each change logged
npx tsx src/scripts/phone-hygiene.ts --revert=<run id> --apply
```

The script **only normalises formats**. Two accounts that share one number are listed as *proposed merges* for a person to approve. The script never merges anything, and has no merge flag. A format change that would give two accounts the same `users.phone` is blocked. Output masks every number.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `IDENTITY_HASH_PEPPER` | required, at least 32 characters | The key for contact identity keys. Without it, contact links are skipped. |
| `IDENTITY_STITCHING` | on | `off` stops all identity linking (the rollback). |
| `ANALYSIS_EXCLUSIONS` | on | `off` makes reports read every row again. |

**Permissions.** Full-access roles hold all of them. Baselines apply only to empty roles; otherwise assign them in *Roles*.

| Permission | Allows | Baseline roles |
|---|---|---|
| `customer_data.view` | Customer 360 | SUPPORT_OPERATOR, SECURITY_ADMIN |
| `privacy_requests.manage` | Handling privacy requests | SECURITY_ADMIN |
| `customer_dna.read` | Segments, reading Customer DNA | (existing) |
| `customer_dna.manage` | Changing segments | (existing) |
| `analytics.read` | Customer value | (existing) |
| `identity.review` | Identity conflicts | (existing) |
