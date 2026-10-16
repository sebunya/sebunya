# Location intelligence — design and roadmap (2026-10-16)

How GoldPlus uses location to deliver better, know customers better and personalise the site, and the rules that
keep it lawful. Read with `docs/location-module-brief.md`, `docs/delivery/CONTRACT.md` and the privacy page.

## 1. Ground rules (the self-critique that shaped everything below)

**Two kinds of location data, two sets of rules.**

| Source | Ours? | What we may do |
|---|---|---|
| The area a customer picks or types (our gazetteer) | Yes | Price, promise, segment, personalise, learn |
| A customer's own pin: phone GPS, shared WhatsApp location, pasted map link or Plus Code | Yes, personal data | Deliver, price, learn area points; retention per privacy page (180 days on orders; saved-address pins until removed) |
| A rider's handover point, "easy / hard to find", outcomes | Yes | Place memory, area points, calibration (same retention) |
| Google Places results (names, addresses, points) | **No** — Google Maps Content | Show (with "Google Maps" credit), keep place IDs indefinitely, keep lat/lng ≤ 30 days, give the rider a pin and a Google Maps link. Nothing else. |

Google Maps Platform terms, checked 2026-10-16 (cloud.google.com/maps-platform/terms and /maps-service-terms):
- **ToS §3.2.3(a)–(b)** no scraping, no caching except as the service terms allow.
- **ToS §3.2.3(c)(iv)** no Places latitude/longitude as input to point-in-polygon analysis → a Google point is
  never matched to one of our areas and never prices an order (`pinOf`, the live quote and the picker all refuse).
- **ToS §3.2.3(c)(vii)** no Google content to train or improve models → Google points never enter calibration,
  area points, Customer DNA or segments.
- **Service terms §3** place IDs may be cached indefinitely; **§14.3** Places lat/lng up to 30 consecutive days
  (we purge at 29, nightly); **§14.1–14.2** Places content may be shown without a map, never on a non-Google map.

So "legal derived data from Google" is narrow by design: the place ID (a permanent, re-openable reference to the
building) and a 30-day point for the rider. Everything that makes us smarter comes from data customers and riders
give us, which is also the data that is actually about *our* deliveries.

**Uganda Data Protection and Privacy Act 2019.** Location data identifies a person (the Act's definition), so:
collect only on the customer's action (no background location, no IP inference); say why at collection; keep
coordinates shorter than address text; never show one customer's pin to another; a privacy-policy change is
flagged to the owner, not written by us. Registration with the Personal Data Protection Office is the owner's to
confirm.

**Earlier decisions respected.** Riders found raw Plus Codes useless on the road (review board 2026-10-15) and
customers never type postcodes (location brief) — so the "special code" is not a coordinate code; see §4.

## 2. Built in this change

1. **"Deliver to", site-wide.** The area the customer told us (chosen on a product page or the cart, or their last
   checkout on this device; area only — never coordinates, never inferred from IP) prices the product page and cart
   quote, opens checkout already chosen, and drives the header: in Kampala & Wakiso the same-day line names their
   area; outside it there is no same-day line (a promise they cannot have). Cookie `gp_deliver_to`, httpOnly,
   "Forget my area on this device" on the chooser. Product pages are not cached (Cloudflare `DYNAMIC`).
2. **Customer DNA.** New traits from the customer's own orders: *usual delivery area* (OBSERVED) and *how they
   receive orders* (delivered / collected / distinct areas / share to Greater Kampala; DERIVED). New segment rules:
   GREATER_KAMPALA, AREA, COLLECTS. Greater Kampala = Kampala, Wakiso, Mukono, Mpigi (the gazetteer's metro set).
3. **Place memory for riders.** The rider card shows what earlier deliveries to the same customer number in the
   same area taught us: how many times, whether riders found it hard, the last failed reason, and the last accurate
   rider handover point (while retention keeps it). Our records only.
4. **Plus Codes in.** A Plus Code typed or pasted (Google Maps shows one for any pin; businesses list them — ours is
   8H7H+M5M Kampala) becomes a pin offline via the open-source algorithm (`packages/shared/src/locations/
   openLocationCode.ts`, Apache-2.0, verified against the official test vectors). Short codes resolve around
   central Kampala; a short code named for a far town is refused rather than guessed.
5. **Google Places compliance fix.** A building picked from Google is a rider pin and a Google Maps link only; the
   customer names the area with our search, and that prices the order.

## 2b. Location signals (0193) — the experience comes first

**Owner decision, 2026-10-16:** the store's experience and personalisation take priority. Signals link to the
visitor's profile (and customer) whatever their consent state — the same rule the homepage hero has followed since
2026-08-07 — with the consent state recorded on each row for marketing uses that respect it. "Locate me" keeps the
customer's own pin. Rows are kept three years (`LOCATION_SIGNAL_RETENTION_DAYS`, default 1095). The only hard limit
is contractual: Google Places points never become signals, area matches, learning or DNA (Maps Platform Terms
§3.2.3(c)).

| Signal | Captured when | Used for |
|---|---|---|
| `deliver_to_set` | "Deliver to" chosen (product page, cart) or an order placed | The visitor's profile; follows a signed-in customer to every device; homepage zone; header; product page and cart fees |
| `quote_shown` | A delivery fee shown for a known area to a human visitor | Demand by area; fee shock; typical fee per area; Customer 360 "areas they priced delivery to" |
| `locate_offer_chosen` / `_missed` | After "Locate me" the customer took an offered area (rank) or typed another | The customer's pin + distance: nightly area points learn from chosen pins (≤ 100 m); flagged areas get a suggested point (median of chosen pins) for a person to apply |

**Server side first.** Middleware resolves "Deliver to" once per document (cookie → last checkout → the profile on
the server, at most one lookup a day for a visitor without one) into `Astro.locals.gpDeliverTo`; the header,
homepage, product page, cart and checkout all read that one value.

**Popular in <area>.** `GET /recommendations/near-you`: products customers in the visitor's area actually bought
(paid orders, at least two different buyers per product, buyer = account or phone), widening to the district then
Greater Kampala; hidden with fewer than four. Area-level, the same for everyone there, cached per area.

## 3. Smarter delivery — next steps (from our own data)

- **Hour-of-week and area learning** already exists (calibration proposes, a person accepts). Feed it *place
  memory*: "hard to find" places get a last-mile minutes allowance; first-attempt failures by area flag areas whose
  points need a rider visit.
- **Dispatch batching by corridor.** Orders on the same road corridor inside one run window → one rider, one route.
  The corridor is already on every quote capture.
- **Demand map for stock and pickup points.** Orders and "Deliver to" choices by area (counts only) show where a
  partner pickup point or a second dispatch origin would cut fees most.
- **Search misses → gazetteer.** Already a loop; add "Deliver to" misses to it.

## 4. The "special code" — recommendation, needs an owner decision

**GoldPlus Place Code**: an opaque, shareable code for a saved address, e.g. `GP-7KQ-4MX`. Not coordinates — a key
to a place we know: area, the customer's own pin, the landmark line, place memory.

What it is for:
- **"Send to my place"**: a relative in Gulu or a colleague shares their code; the buyer enters it at checkout and
  the order goes to that saved place. The buyer sees the area and first name only, never the pin or phone.
- **Re-ordering by WhatsApp or phone**: "deliver to GP-7KQ-4MX" — Goldie and staff need no directions again.
- **Offices and shops**: one code for a building many people order to.

Why it needs your decision: it lets someone who has the code send parcels to that place. Safeguards proposed:
the owner of the address creates it (never automatic), can revoke or replace it, every use is visible to them,
lookups are rate-limited, and nothing about the place beyond area + first name is ever shown to the sender.
Requires a migration (code on `addresses`, an audit of uses) and a privacy-page addition (owner writes/approves).

## 5. Personalisation — next steps

- **Area-aware Goldie**: "Deliver to Najjera" in Goldie's context so answers about delivery fees and timing are for
  that area (area only; Goldie never sees pins).
- **Nearest pickup point** suggested beside the delivery fee when one is closer and free.
- **Area-honest promotions**: "free delivery in Greater Kampala this weekend" shown only where true. Ethical rules
  apply: no fake urgency, no invented scarcity, real fees only.
- **Consent**: area-based pricing and promises are service (the customer told us where to deliver). Using area in
  *marketing* segments rides on the existing personalisation consent gate (`consent_eligible`), as today.

## 6. What we deliberately do not do

- No IP-based location, ever presented as fact.
- No Google point in pricing, area matching, learning, DNA or segments; no Google names or addresses stored.
- No background or repeated location requests; location is asked for on the customer's tap only.
- No pin shown to anyone but staff and the assigned rider.
