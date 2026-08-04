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
