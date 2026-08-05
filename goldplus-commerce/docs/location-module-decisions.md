# Location Module — Decisions and Assumptions Log

Every assumption made during the build is recorded here with date and reasoning.
Questions reserved for Rob (brief PART P) are recorded as QUESTIONS and wait for
an answer — they are never resolved silently in code.

## Open questions for Rob (PART P — do not build until answered)

1. **Delivery fees, SLAs, COD limits and carrier per zone (Z1–Z4).** The brief
   seeds zones with codes and names only; every fee/threshold/SLA/COD limit is
   NULL until you set them in admin. AWAITING ANSWER.
2. **Coordinate retention period.** Must be shorter than address retention; a
   deletion job implements it. Proposal will be made in the privacy stage;
   the period itself is yours. AWAITING ANSWER.
3. **Do pickup points launch with Z3/Z4 or later?** AWAITING ANSWER.
4. **Kabale, Moroto, Nakasongola zone placement** (city status approved,
   operational status disputed — stay in Z3?). AWAITING ANSWER.
5. **Paid geocoder behind the feature flag at all?** AWAITING ANSWER.
6. **Which of the twenty absent metro localities become full areas rather than
   aliases** once real order volume shows demand. AWAITING ANSWER (post-launch).

## Decisions needed before build starts (found in PART 1 audit)

7. **Fee-system reconciliation.** The repo already ships a delivery-fee system
   (per-district `delivery_zones` + 8-band road-distance model +
   `delivery_pricing_policy`, released 2026-08-04). The brief specifies a
   different one (4 coarse zones Z1–Z4 carrying fee/SLA/COD/carrier policy).
   These must be reconciled, not stacked. Options are laid out in the PART 1
   report. AWAITING DECISION on which system owns fee logic.
8. **District count reconciliation.** The repo's verified vocabulary carries
   136 districts (including Terego); `uganda_districts_lookup.csv` carries 135.
   Import assertions must agree on one number before stage 2. To be resolved
   when the data files arrive and can be diffed against the vocabulary.

## Assumptions

- 2026-08-04 — **Branch**: the brief (PART A) says work on `feat/location-module`;
  Rob's pickup instructions say stay on
  `claude/amazon-grade-goldplus-commerce-os-v5-production-20260802`. The pickup
  instruction is newer and explicit — staying on the current branch.
- 2026-08-04 — **Data files not yet present**: the six files in the brief's
  PART D were not on this machine at audit time (only the brief and the source
  PDF exist in ~/Downloads). Checksums cannot be verified until they arrive;
  stages 2+ are blocked on them. Nothing was fabricated in their place.

## Resolved by Rob (2026-08-04, stage 1 approval)

- **Decision #7 — fee ownership (Option A, APPROVED):** The existing engine
  (per-district `delivery_zones` → observed medians → band model) remains the
  single owner of every delivery FEE in the codebase; the brief's `delivery_zone`
  Z1–Z4 table owns only non-fee policy (SLA, COD allowance/limits, free-delivery
  threshold, carrier) plus a nullable district-inherited fallback fee — and no
  fee, SLA or COD limit is ever hardcoded or defaulted: unset means unset, and
  unset blocks zone activation.
- **Decision #8 — district count:** RESOLVED. The gap is Terego (created
  1 Jul 2020 from Arua; the 2019 source omits the whole county — recorded in the
  exceptions file as DISTRICT_NOT_REPRESENTED / SOURCE_OMITS_WHOLE_COUNTY).
  `UGANDA_DISTRICTS` keeps 136 including Terego; Terego has zero areas, resolves
  to the PART H manual path, and a guard test asserts exactly one zero-area
  district and that it is Terego.
- **Permissions:** the stage-1 guard table approved as proposed (existing
  vocabulary only; all four mutating Locations views take mutating permissions).
- **Scope additions authorised:** order lifecycle delivery states +
  `fulfilment_deliveries` population (stage 2); address edit endpoint with full
  audit (stage 4); dedicated abuse-control family for public search; offline
  index on a dedicated cached asset URL (SENSITIVE_ROUTES untouched); loyalty
  two-key flag pattern; no UI framework.

## Assumptions (continued)

- 2026-08-04 — **Data files still absent at stage-2 start.** `data/locations/v1/`
  does not exist and Spotlight finds none of the six filenames anywhere on this
  machine (the Downloads `zone-files*.zip` archives are unrelated DNS zone
  files). Proceeding with every file-independent deliverable; the import script
  carries ALL brief assertions plus the MD5 gate and refuses to run without
  verified files. Nothing data-dependent is faked or stubbed with sample rows.
- 2026-08-04 — **`customer_address` = additive evolution of `addresses`** (the
  existing table keeps its name; brief's name is spec-speak). Orders never
  reference address rows today, so widening is zero-risk.
- 2026-08-04 — **Z1–Z4 `zone_name` seeded equal to its code** ("Z1"…): the brief
  says to seed codes and names but the names live in `uganda_districts_lookup.csv`
  which has not arrived; the import updates names from the file when present.
  No fee/SLA/COD value is seeded — all NULL, activation blocked.

---

# PART P DECISION SHEET (2026-08-05 — one sheet, awaiting Rob)

**1. Zone fees, SLAs, COD limits, carrier (Z1–Z4).** All NULL, activation blocked.
RECOMMEND starting with Z1/Z2 only: Z1 SLA 4–24h own_rider, Z2 24–48h
third_party_rider, COD allowed with a 1,000,000 UGX Z1 / 500,000 UGX Z2 ceiling;
Z3/Z4 stay inactive until pickup-point coverage exists. Per-district FEES stay in
the delivery-zones cockpit (decision #7); the Z fallback fee only catches districts
without a finer price. Wrong: an over-generous COD ceiling turns refused deliveries
into direct losses — the entire premise of the module.

**2. Coordinate retention.** RECOMMEND **180 days for pins vs indefinite for the
address text**, deletion job in a follow-up pass once you confirm. Wrong-long:
DPPA 2019 exposure for precise location data with no delivery purpose left.

**3. Pickup points at launch.** RECOMMEND **yes for Z3/Z4** the moment ops can
name real bus-parcel offices — the manager ships ready, points create inactive.
Wrong-no: upcountry customers get door-delivery promises nobody can keep.

**4. Kabale / Moroto / Nakasongola zoning.** RECOMMEND **keep in Z3** until their
operational status settles; a zone move is one lookup-file cell at the next data
version, never a code change.

**5. Paid geocoder behind the flag.** RECOMMEND **no** — the alias learning loop
is already live in production and compounds with every miss; third-party coverage
of Ugandan informal areas is weaker than this will become. Revisit only if the
zero-result rate stays high after the gazetteer import + one month of promotion.

**6. Metro localities: alias → full area promotion.** Wait for volume: the
unresolved-searches view ranks candidates by real frequency. RECOMMEND promoting
any locality that clears ~25 orders/month; promotion is an ops action in the
workspace, not a release.
