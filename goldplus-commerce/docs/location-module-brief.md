# GoldPlus Location and Delivery Address Module
## Build brief for Claude Code, version 2

---

# PART A. How to run this brief

Commit this file to the repo as `docs/location-module-brief.md` before starting. Add a pointer to it in `CLAUDE.md` so it stays in context across sessions.

Start with:

```
claude
> read docs/location-module-brief.md, then do PART C only. Do not write code.
```

Rules of engagement for the whole build:

- Work on a branch named `feat/location-module`. Never commit to main.
- Never run a destructive database command. No `DROP`, no `TRUNCATE`, no unreviewed `DELETE`. Migrations are additive and reversible.
- Stop for review at the end of every stage in PART M. Do not run ahead.
- Where this brief conflicts with what you find in the repo, stop and tell me. Do not resolve it silently.
- Where you must assume something, write the assumption into `docs/location-module-decisions.md` with the date and your reasoning.
- Every number in this brief that describes the dataset is verified. If your import produces a different number, the import is wrong, not the brief.

---

# PART B. The premise

GoldPlus sells phone and tech accessories online in Uganda. Address capture at checkout is the largest single cause of failed, delayed and returned deliveries, and on cash on delivery orders a failed delivery is a direct loss, not just a delay.

The premise that drives every decision in this module:

**Ugandans do not know their postcode and will never type one.** Uganda's postcode scheme exists only as a 2019 draft from the Ministry of ICT and National Guidance. It was never operationalised for last mile delivery. Almost no customer knows their parish code, and most do not know which parish they live in.

What a Ugandan customer actually knows:

- A neighbourhood or trading centre name: Ntinda, Kireka, Najjera, Kalerwe, Bweyogerere, Kajjansi
- A landmark: "opposite Capital Shoppers", "near Total Kisaasi", "Kamuli road stage", "behind Mengo Hospital"
- Their phone number, which is what the rider will actually call
- Increasingly, a WhatsApp shared location pin

The module is built around those four things. The postcode is metadata stored silently for reporting and for the day Posta Uganda operationalises the scheme. It is never required, never routed on, and never prominent.

Three further realities shape the design and are not optional:

1. **Cash on delivery is a large share of Ugandan e-commerce.** Address quality is therefore a financial control, not a convenience feature.
2. **Upcountry delivery runs on bus parcel offices and courier agents, not door to door.** A pickup point is a first class delivery method, not an afterthought.
3. **WhatsApp is the dominant coordination channel between rider and customer.** The module must produce artefacts that work inside WhatsApp.

---

# PART C. Repo audit, to be done before any code

Read the repository and report back on all of the following. Produce a written plan afterwards. I approve the plan before you build.

1. The current address and checkout flow end to end: schema, API handlers, and every UI surface that captures, validates, edits or displays an address.
2. Drizzle schema files, migration tooling, and how migrations are applied in each environment.
3. Hono route structure, middleware, auth, rate limiting, and error conventions.
4. Astro island hydration on the checkout page, the current client bundle size, and the service worker and PWA caching strategy already in place.
5. Postgres version, and whether `pg_trgm`, `unaccent` and `btree_gin` are available and enabled.
6. Every existing location, district, region or delivery-zone list in the codebase, including hardcoded arrays, JSON fixtures and enum types. List all of them. They will all be replaced.
7. How many existing customer addresses and orders carry address data, in what shape, and how dirty it is. Sample fifty and tell me what you see.
8. How the existing Fraud Triage, Customer DNA, Measurement and Loyalty modules consume address or location data today, if at all.
9. The current delivery fee logic, wherever it lives.
10. Whether any privacy or data retention policy in the repo already covers address or location data, and what the existing Privacy Policy says. This module handles personal data under Uganda's Data Protection and Privacy Act 2019 and must not contradict the published policy.

Report a baseline before you change anything: current failed delivery rate, current address edit rate after order placement, and current share of orders that required a phone call to locate. If those numbers are not instrumented today, say so, and instrument them in stage 1 so improvement is measurable.

---

# PART D. The data you are given

Seven files. Place them in `data/locations/v1/`. Do not edit them by hand.

| File | Contents |
|---|---|
| `uganda_locations_master.csv` | 5,805 area records across 135 current districts |
| `goldplus_metro_areas.csv` | 362 Kampala and Greater Kampala records, the same-day set |
| `goldplus_metro_aliases.csv` | 28 alias rows: spelling variants, umbrella names, and localities absent from the official source |
| `uganda_districts_lookup.csv` | 135 districts with postcode prefixes, code ranges and delivery zones |
| `uganda_locations_exceptions.csv` | 255 rows recording every known defect in the source data |
| `goldplus_locations_seed.sql` | Postgres DDL and inserts for `ug_area` and `ug_area_alias` |
| this brief | the spec |

Provenance. The master data is extracted from the Ministry of ICT and National Guidance document "Draft Postcodes for Uganda", April 2019, 201 pages. It was cross-validated with two independent extraction engines and reconciled record by record. Treat it as authoritative for administrative structure and unreliable for commercial place names.

## D.1 Versioning

The gazetteer will change. Aliases will be added weekly, corrections will land, and Posta Uganda may publish a final scheme.

- The directory is `v1`. New releases go in `v2` and so on. Never overwrite a released version.
- `ug_area` carries a `data_version` column set at import.
- Every saved address stores a snapshot of the area label, district and postcode as they were at save time. A later gazetteer change must never silently rewrite the meaning of a historical order.
- The import is idempotent. Running it twice changes nothing. Running it against a new version produces a diff report of added, changed and removed areas, written to `docs/location-data-changelog.md`.

## D.2 Defects you must handle in code, never by editing the data

1. **Postcode is not unique.** Fourteen codes are assigned to two different areas each. Never make `postcode` a primary key, a unique index, or a lookup key. The primary key is `area_slug`.
2. **Two records are not selectable.** `51713` in Kiryandongo has a blank area name in the source, and `2103` in Sironko is a four digit typo. Both carry `selectable = false`. Filter them from every customer facing query and from every public endpoint.
3. **Twenty-three postcodes appear in the numbering sequence with no area assigned.** Validation must reject any postcode not present in `ug_area`.
4. **Fifty-seven area names are printed without word breaks**, for example `OldBomaWard` and `NakivuboShauliyako`. Always display `parish_or_area_clean`. Keep `parish_or_area_source` for audit only.
5. **One hundred and eleven area names repeat inside a single district**, and twelve display labels are exact duplicates. Never render a bare area name in a list. Always render `display_label`.
6. **Districts changed after the source was written.** One hundred and forty records belong to districts created on 1 July 2020. Display `current_district`. Keep `district_2019_source` for reference and reporting.
7. **Terego district has no coverage at all.** The source omits the entire county. A Terego customer must fall through to the manual path in PART H.
8. Load `uganda_locations_exceptions.csv` into a `ug_data_exception` table and expose it read only in the admin Locations section. Ops needs to see known defects rather than rediscover them.

## D.3 The coverage gap this module exists to close

Twenty of the highest traffic delivery localities in the Kampala metropolitan area are absent from the official parish list entirely:

Kalerwe, Kisaasi, Kulambiro, Kigowa, Kinawataka, Munyonyo, Bunga, Najjera, Naalya, Namugongo, Kasangati, Lubowa, Namasuba, Zana, Kajjansi, Bwebajja, Garuga, Kawuku, Bulenga, Namanve.

Three more exist only under a different spelling: the source writes Bogolobi for Bugolobi, Rubaga for Lubaga, Matuga for Matugga.

`goldplus_metro_aliases.csv` covers all of these, each anchored to its nearest listed area with an explicit confidence label. The alias table is not a one-off import. It is the living surface of this module and PART J is how it grows.

---

# PART E. Schema

Build proper Drizzle schema and migrations. The seed SQL is a starting point, not the final shape.

## E.1 Reference tables

**`ug_area`** as in the seed file, plus `data_version`. Enable `pg_trgm` and `unaccent`. Add a GIN trigram index on the normalised searchable text and a btree index on `current_district`, `delivery_zone` and `postcode`.

**`ug_area_alias`** as in the seed file, plus `source` enum of `seeded`, `ops_promoted`, `imported`, and `created_at`, `created_by`.

**`ug_area_group`** and **`ug_area_group_member`**. Several parishes are one place in customers' minds. Nsambya is split into Central, Railway, Police Barracks and Housing Estate. Nakasero is split into I, II, III and IV. Kololo into I to IV. A group presents as one selectable entry named "Nsambya" and, once chosen, optionally offers the sub-areas. Seed groups for at least Nsambya, Nakasero, Kololo, Kamwokya, Mulago, Makerere, Bwaise, Kisenyi, Kibuye, Katwe, Mbuya, Naguru, Bukoto, Makindye, Najjanankumbi and Kansanga-Muyenga. Derive the candidate list programmatically by finding areas in one district whose cleaned names differ only by a trailing roman numeral or a qualifier, then confirm the list with me before seeding.

**`ug_data_exception`** loaded from the exceptions CSV, read only.

## E.2 Operational tables

**`ug_landmark`**
- `id`, `area_slug` FK, `name`, `landmark_type` enum of `stage`, `school`, `church`, `mosque`, `hospital`, `clinic`, `fuel_station`, `supermarket`, `shop`, `market`, `bank`, `hotel`, `bar_restaurant`, `office_building`, `roundabout`, `bridge`, `other`
- `usage_count`, `verified` boolean, `created_from_order_id` nullable, `gps_lat`, `gps_lng` nullable
- Unique on `(area_slug, lower(name))`

**`ug_pickup_point`**
- `id`, `name`, `operator` enum of `goldplus_shop`, `agent`, `bus_parcel_office`, `courier_branch`, `locker`
- `area_slug` FK, `physical_address`, `landmark_text`, `gps_lat`, `gps_lng`
- `phone`, `opening_hours` jsonb, `serves_districts` text array, `active`, `notes`
- This is how upcountry actually works. It is not optional.

**`ug_search_miss`**
- `id`, `raw_query`, `normalised_query`, `session_id`, `customer_id` nullable
- `result_count`, `resolved_area_slug` nullable, `resolved_via` enum of `alias`, `group`, `landmark`, `manual_entry`, `pickup_point`, `abandoned`
- `device_hint`, `created_at`

**`delivery_zone`**
- `zone_code` PK, `zone_name`, `sla_hours_min`, `sla_hours_max`, `fee_ugx`, `free_delivery_threshold_ugx`
- `cod_allowed` boolean, `cod_max_order_value_ugx`, `prepay_required_above_ugx`
- `carrier` enum of `own_rider`, `third_party_rider`, `bus_parcel`, `courier`, `pickup_only`
- `active` boolean
- Seed Z1, Z2, Z3, Z4 with codes and names only. Every fee, threshold, SLA and COD limit is NULL. The admin UI must require them before a zone can be activated. Do not invent numbers. Rob sets these.

**`customer_address`**
- `id`, `customer_id` nullable for guest checkout, `label` free text with suggested values Home, Work, Shop, Other
- `area_slug` FK nullable, `area_group_id` nullable, `landmark_text` required, `additional_directions` nullable
- `recipient_name`, `phone_primary` required, `phone_secondary` nullable
- `gps_lat`, `gps_lng`, `gps_accuracy_m`, `gps_source` enum of `device`, `pasted_link`, `ops_entered`, `gps_captured_at`
- `raw_address_text` nullable, used only on the manual path
- `resolution_status` enum of `resolved`, `needs_ops_review`, `ops_confirmed`, `undeliverable`
- `delivery_method` enum of `door`, `pickup_point`, `pickup_point_id` nullable
- `snapshot_area_label`, `snapshot_district`, `snapshot_postcode`, `snapshot_data_version`
- `is_default`, `deleted_at`
- Never hard delete. Orders reference addresses historically.

**`address_audit`**
- Append only. Every create, edit, ops resolution and status change, with actor, timestamp, before and after. Required because customers phone in address changes after ordering and disputes follow.

## E.3 Import and assertions

Write a seed script that loads the CSVs and asserts, failing loudly on any miss:

- 5,805 area records
- 28 alias records
- 135 distinct values of `current_district`
- 255 exception records
- zero duplicate `area_slug`
- every `area_slug` in the alias file resolves to an existing area
- exactly 2 records with `selectable = false`
- exactly 140 records with `district_changed = Y`

Do not silently skip rows. A partial import is a failed import.

## E.4 Migrating existing address data

This is free alias material and must not be skipped.

1. Take every existing address in the system.
2. Run each through the matching pipeline in PART F.
3. Auto-link where the match is exact or a confident alias hit.
4. Everything else goes into the ops review queue with the original text preserved.
5. Report the match rate. Every distinct unmatched string is a candidate alias, ranked by frequency.
6. Never overwrite the original text. Add the link, keep the source.

---

# PART F. Search and autocomplete

A single search input is the primary interface. Cascading district and sub-county dropdowns exist only behind a "Browse by district" link. Most customers do not know their sub-county or parish, and three sequential taps on a low-end Android phone loses orders.

## F.1 Matching pipeline

Normalise query and indexed text: lowercase, strip punctuation and diacritics, collapse whitespace, then apply the orthography folding in F.2.

Match in this order and return the union, ranked by F.3:

1. Exact match on normalised alias
2. Exact match on normalised area name
3. Exact match on an area group name
4. Prefix match on area name, alias, group name or landmark name
5. Trigram similarity on area name and alias, threshold tuned to roughly 0.35
6. Landmark name match, returning the parent area
7. Pickup point name match, returning the pickup point as a distinct result type

Every result carries a `match_type` so the UI can render provenance and so we can measure which layer is doing the work.

## F.2 Ugandan orthography folding

Uganda writes the same place several ways. Implement a normalisation function, not a synonym list, and unit test every rule with real names from the dataset:

- L and R interchange: Lubaga and Rubaga, Kalerwe and Karerwe
- Doubled consonants collapse: Matugga and Matuga, Najjera and Najera, Kajjansi and Kajansi, Ggaba and Gaba, Bbunga and Bunga, Kkonko and Konko
- Leading vowel may be dropped or added: Entebbe and Ntebbe
- `ny` and `nny`, `ng` and `ng'`
- `ki` and `ky`, `bi` and `by`, `gi` and `gy` before vowels
- `w` doubling: Bunamwaya and Bunamwaaya
- Long vowels written single or double: Naalya and Nalya, Kisaasi and Kisasi, Kasaana and Kasana
- Terminal `-e` and `-ye`: Kyebando and Kyebandoe
- Common English and Luganda pairs where both are in use for the same place

Apply the folding, then trigram similarity on the folded form. Test that folding does not collapse genuinely distinct places: Bunga and Busanga must stay distinct, Kasangati and Kasana must stay distinct, Namasuba and Namayuba must stay distinct. These three pairs are known false-positive traps and each needs an explicit negative test.

## F.3 Ranking

1. The customer's saved addresses, always first
2. Areas the customer has ordered to before
3. Delivery zone order: Z1, then Z2, then Z3, then Z4
4. Order density for that area, from a nightly materialised view over historical orders
5. Match quality: exact, then prefix, then trigram score
6. Alphabetical as final tie break

Cap at eight results. Always render `display_label`, so two areas named Kikandwa in the same district are distinguishable.

## F.4 Input and interaction

- `inputmode="search"`, `enterkeyhint="search"`, `autocomplete="off"` so browser autofill does not fight the component
- Debounce 150ms. Never one request per keystroke
- On focus and before typing, show the customer's last three used areas, then popular areas in their most likely city inferred from prior orders. Never infer from IP alone, and never present the inference as a fact
- Full keyboard navigation, and touch targets no smaller than 44 by 44 CSS pixels
- Announce result counts to screen readers. The component must be operable without sight
- Plain, low-reading-age labels. No administrative jargon in any customer facing string
- Show a visible "I cannot find my area" link at all times, not only after a zero result

## F.5 Performance and offline

The site is a mobile-first PWA in a market where data is expensive and connections drop.

- Precompute a compressed search index of the 362 metro records, the 28 aliases and the seeded groups, and cache it in the service worker. Report its gzipped size; if it exceeds 60KB, trim fields rather than dropping records
- Metro search must work with zero network and return in under 50ms on a mid-range Android device
- Queries outside the cached set hit the server
- Server search under 200ms at p95. Prove it with `EXPLAIN ANALYZE` in your report
- Address capture must survive a dropped connection. Draft state persists locally and resumes

---

# PART G. The address form

Field order matters. Ask for high-confidence things first.

1. **Delivery method.** Deliver to an address, or collect from a pickup point. Default to address in Z1 and Z2, and surface pickup prominently in Z3 and Z4 where door delivery may not exist
2. **Recipient name**, prefilled from the account when signed in. Gifting is common, so this is not the buyer's name by default
3. **Phone**, required. Accept `07XXXXXXXX`, `+2567XXXXXXXX`, `2567XXXXXXXX` and the same shapes with spaces or hyphens. Normalise to E.164. Validate shape and length strictly. Warn, do not block, on an unrecognised prefix, because operator prefix allocations change and a hard allowlist rots. Echo the normalised number back for confirmation, since a wrong digit here is a failed delivery. Offer to prefill from the mobile money number used at payment when the customer has chosen a mobile money method
4. **Alternative phone**, optional, labelled as a second number the rider can try
5. **Area**, the component from PART F
6. **Landmark**, required free text. Suggestions drawn from `ug_landmark` for the selected area, ranked by usage. Label it plainly, for example: "What is nearby? A shop, stage, church or school the rider will know." Placeholder shows a real example
7. **Extra directions**, optional, multiline
8. **Location pin**, optional, described in G.1

Do not show a postcode field. Do not show region, county or parish fields. Store them, never ask for them.

## G.1 Location pin, two routes in

**Device GPS.** One button, "Use my current location". Request permission, capture lat, lng and accuracy. If accuracy is worse than 100 metres, say so and let the customer decide. Reverse match to the nearest area to pre-select, show which area was matched, and let the customer override. Never silently overwrite a manual selection.

**Pasted WhatsApp or Maps link.** Ugandans routinely share a pin on WhatsApp. Accept a pasted Google Maps, WhatsApp or OpenStreetMap URL in the address field, parse the coordinates out of it, and treat it exactly like a device capture with `gps_source = pasted_link`. Support the common shapes including `maps.google.com/?q=lat,lng`, `google.com/maps/@lat,lng,z`, `goo.gl` and `maps.app.goo.gl` short links resolved server side, and a bare `lat,lng` pair. This is the single highest-leverage input path in the module and it costs almost nothing to build.

If area centroids are not available, do not fabricate them. Capture and store coordinates regardless, pass them to the rider, and skip area pre-selection until centroids exist. Flag the gap rather than approximating. If centroids are added later, OpenStreetMap and the UBOS parish boundary files are the two realistic sources and that is separate work.

## G.2 Saved addresses

- Prompt to save and label after the first successful delivery, not before
- One-tap reuse, default preselected
- Detect near-duplicates on save and offer to update rather than add
- Editable, soft deleted, fully audited
- Guest checkout completes without an account. Never force registration to buy

---

# PART H. Never block a sale on a data gap

This rule overrides convenience everywhere in the module.

If the area is not in the data, search returns nothing, the customer is in Terego, or they simply cannot find themselves, checkout must still complete.

Provide a persistent "I cannot find my area" link that opens a free text address field plus an optional pin. On submission:

- Save with `area_slug` null, `raw_address_text` populated, `resolution_status = needs_ops_review`
- Let the order proceed and be paid for
- Assign the delivery zone from the selected district if one was given; otherwise mark the fee as unconfirmed and hold dispatch, not payment
- Route it to the ops queue in PART J
- Log it to `ug_search_miss`

The same applies to fees. If a zone has no configured fee, return an explicit `fee_unavailable` state and let ops confirm before dispatch. Never substitute a default and never guess.

---

# PART I. Downstream: what the rest of the business needs from this module

## I.1 Rider handoff

Generate, for every dispatched order, a delivery card containing recipient name, both phone numbers, area display label, landmark, extra directions, a maps deep link when a pin exists, order reference, item count, and the cash on delivery amount where applicable.

Make it available three ways: a printable slip, a copy-to-clipboard block formatted for WhatsApp, and a `wa.me` deep link that opens a chat with the recipient prefilled with a short arrival message. WhatsApp is how this coordination actually happens.

## I.2 Cash on delivery controls

- COD eligibility is a zone attribute, not a global setting
- Above `cod_max_order_value_ugx` for the zone, require prepayment or a deposit
- An address with `resolution_status = needs_ops_review` is not COD eligible until resolved
- Track COD failure rate by area and surface it in the admin Locations view. Areas above a threshold get COD disabled automatically, with an ops override

## I.3 Fraud and abuse

Feed the existing Fraud Triage module:

- Velocity checks on phone number and on address across orders and accounts
- Address reputation score derived from delivery success, refusal and return history
- Flag mismatches between the mobile money account name and the recipient name on high-value COD orders
- Blocklist at address and phone level, with an audit trail and an appeal path

## I.4 Other modules

- Customer DNA gains area, zone and delivery success as attributes
- Measurement gains the metrics in PART J.2
- Pricing and Promotions can run area-level free delivery thresholds off `delivery_zone`
- Inventory and Fulfilment gains pickup point stock visibility if pickup points ever hold stock

## I.5 Commercial upside worth noting, not building now

The Astro SSR site can generate a delivery-area landing page per Z1 and Z2 area from this data, for example "Phone accessories delivered in Ntinda". That is 362 pages of long-tail search surface built from a table you now have. Flag it to me as a follow-up. Do not build it in this module.

---

# PART J. The learning loop and admin surface

This is what makes the module improve instead of decay. Build it in the same pass, not later.

## J.1 Admin Locations section at `/admin`

**Unresolved searches.** `ug_search_miss` grouped by normalised query, sorted by frequency, showing what customers eventually selected or whether they abandoned. One click promotes a query into `ug_area_alias` against a chosen anchor, with a confidence label and the actor recorded. This is how Kalerwe, Najjera and the rest enter the system properly.

**Address review queue.** Every address with `resolution_status = needs_ops_review`, with the raw text, any pin, and the customer's phone. Ops assigns an area and can create an alias in the same action.

**Landmark manager.** Landmarks by area with usage counts. Verify, merge duplicates, correct spellings, attach coordinates. Customer-entered landmarks arrive unverified and are promoted by ops confirmation or by crossing a usage threshold.

**Pickup point manager.** Full CRUD, opening hours, districts served, active toggle.

**Zone configuration.** Fees, SLAs, COD limits and carrier per zone, with activation blocked until every required field is set.

**Known data defects.** Read-only view of `ug_data_exception` so ops can see what is already known.

## J.2 Metrics, instrumented from day one

| Metric | Why it matters |
|---|---|
| Search zero-result rate | Direct measure of gazetteer coverage |
| Median keystrokes to selection | Autocomplete quality |
| Share of orders using the manual fallback | Coverage gap in commercial terms |
| Address edit rate after order placement | Picker accuracy |
| Failed or delayed delivery rate by area and zone | Ties address quality to money |
| COD failure rate by area | Direct loss attribution |
| Share of orders carrying a location pin | Adoption of the highest-value input |
| Alias table growth per week | Whether the learning loop is running |
| Ops review queue depth and time to resolve | Whether the loop is staffed |

Wire these into the existing measurement layer. Do not build a parallel analytics path.

---

# PART K. Privacy, retention and compliance

Addresses, phone numbers and precise coordinates are personal data under Uganda's Data Protection and Privacy Act 2019. The existing compliance pack in this repo must not be contradicted.

- Collect the minimum. Precise coordinates are captured only on explicit customer action, never in the background, never continuously
- State the purpose at the point of capture in plain words: to deliver this order
- Set a retention period for coordinates that is shorter than for the address itself, and implement the deletion job. Propose a period and let me decide it
- Provide a customer-facing delete path for saved addresses that hard-deletes the address record while preserving what the order legally needs
- Never expose another customer's address, landmark or pin through any endpoint, including the landmark suggestion endpoint. Landmark suggestions must be aggregated and stripped of any link to the customer who entered them
- Restrict admin access to addresses by role, and log every admin view of an address in `address_audit`
- Update the Privacy Policy text if this module collects anything the current policy does not describe. Flag the delta to me; do not edit legal copy yourself

---

# PART L. What not to do

- Do not add a postcode input anywhere in the customer flow
- Do not require district, county, sub-county or parish selection before search
- Do not invent delivery fees, SLAs, distances, COD limits or area centroids. Expose the unknown state and let ops fill it
- Do not auto-select a result the customer did not tap
- Do not make the landmark field optional
- Do not make a paid geocoding API the primary source. Third-party coverage of Ugandan informal areas and trading centres is weaker than this alias layer will become. Any such API goes behind a feature flag as an enhancement, never as a dependency
- Do not edit the CSV files to work around a defect. Handle defects in code so provenance stays intact
- Do not silently drop rows on import
- Do not let a gazetteer update rewrite the meaning of a historical order
- Do not build a parallel analytics or admin shell. Extend what exists
- Do not ship without the migration in PART E.4 run and reported

---

# PART M. Stages, each ending in review

1. Repo audit, baseline metrics, written plan
2. Schema, migrations, import with assertions, exceptions table, area groups proposal
3. Orthography folding and search service, with the full positive and negative test suite
4. API endpoints and tests
5. Migration and matching of existing addresses, with a match-rate report and a ranked list of candidate aliases
6. Address form, search component, pin capture including pasted-link parsing, pickup point selection
7. Offline index and PWA integration
8. Rider handoff artefacts, COD controls, fraud signals
9. Admin Locations section and metrics instrumentation
10. Full acceptance pass against PART N, then staged rollout per PART O

Commit in small reviewable pieces. Flag every assumption rather than choosing silently.

---

# PART N. Definition of done

Build is complete when every item below is demonstrated, not merely coded.

**Data**
1. Import loads 5,805 areas, 28 aliases, 135 districts and 255 exceptions with all assertions passing
2. Re-running the import changes nothing
3. The two non-selectable records never appear in any customer facing result or public endpoint
4. An unknown or unassigned postcode is rejected by validation
5. Existing addresses are migrated with a reported match rate and a ranked candidate-alias list

**Search**
6. "ntinda" returns Ntinda first, under 200ms server side and under 50ms from the cached index
7. "bugolobi", "lubaga", "matugga", "najera", "kisasi", "gaba" and "ntebbe" each resolve correctly, one test each
8. "kalerwe", "najjera", "namugongo" and "kajjansi" resolve through the alias layer
9. "bunga" does not return Busanga; "kasangati" does not return Kasana; "namasuba" does not return Namayuba
10. "nsambya" returns one grouped entry, not four fragments
11. Two areas sharing a name in one district render distinguishably
12. Search works fully offline for metro areas after the first visit

**Checkout**
13. A paid order completes with a free text address when search fails, and lands in the ops review queue
14. Guest checkout completes without account creation
15. A pasted Google Maps or WhatsApp location link is parsed into coordinates and stored
16. Device GPS capture stores coordinates and accuracy and passes them to the order
17. A pickup point order completes end to end
18. A zone with no configured fee returns `fee_unavailable` and does not fall back to a default
19. Draft address state survives a dropped connection
20. The form is fully operable by keyboard and by screen reader

**Operations**
21. An unresolved search is promoted to an alias from the admin UI and the next search for that term resolves
22. An ops-resolved address moves out of the queue and becomes COD eligible
23. The rider delivery card renders, copies to WhatsApp, and deep links to a chat and to a map pin
24. Every metric in PART J.2 is emitting

**Hygiene**
25. Every hardcoded location list found in PART C is removed
26. Every admin view of an address is logged
27. Tests cover orthography folding both ways, ranking order, duplicate-name disambiguation, group behaviour, the manual fallback, link parsing, and phone normalisation

---

# PART O. Rollout

- Ship behind a feature flag with the old flow intact
- Canary on ten percent of sessions for one week, watching zero-result rate, manual fallback share and checkout completion
- Before full release, run twenty real addresses drawn from past orders through the new picker and record how many resolve on the first attempt. Report the number. If it is below eighty percent, the alias layer is not ready and we extend the canary rather than launching
- Keep a one-command rollback to the old flow for thirty days
- After full release, review the ops queue and unresolved-search list weekly for the first month, and promote aliases from real traffic

---

# PART P. Open questions for me, not for you to decide

Answer these in `docs/location-module-decisions.md` as questions, not answers, and wait for me:

1. Delivery fees, SLAs, COD limits and carrier per zone
2. Coordinate retention period
3. Whether pickup points launch with Z3 and Z4 or later
4. Whether Kabale, Moroto and Nakasongola should stay in Z3, given that their city status was approved but their operational status is disputed
5. Whether to add a paid geocoder behind the flag at all
6. Which of the twenty absent metro localities should become full areas in the gazetteer rather than aliases, once real order volume shows where customers actually are
