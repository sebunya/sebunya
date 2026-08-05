# GoldPlus Delivery Estimation — operations

> Build brief version 7, PARTS 5 through 9, plus PART 10 (decisions reserved
> for Rob, appended here as its natural home — the brief assigned it no file).
> The contract is in `CONTRACT.md`. The model is in `MODEL.md`.

---

# PART 5. The quote commitment

Three stages, three different messages. Never a blanket "fees may vary" notice
anywhere.

**Stage 1, before an area is known.** Genuinely an estimate, labelled as one:

> Estimated from your area. Your exact delivery fee is confirmed at checkout,
> once you tell us where you are.

**Stage 2, at checkout and on the order confirmation.** Fixed. Do not hedge it:

> This delivery fee is fixed for this order. It can only change if you change
> your delivery address, or if the address turns out to be in a different area
> from the one you selected. If that happens we will contact you and agree it
> before we deliver. Our rider will never ask you for a different amount at
> your door.

The last sentence is a control, not copy. It prevents the most common failure
in this market.

**Stage 3, variance after placement.** Only these causes, each recorded with a
reason code:

- `ADDRESS_CHANGED_BY_CUSTOMER`
- `AREA_MISMATCH_ON_RESOLUTION` — the landmark, pin or ops review places it in
  a different area or band, including anything resolved through a name
  collision
- `ACCESS_MODE_DIFFERENT` — turns out to need water access, or is unserviceable
- `REDELIVERY_AFTER_FAILED_ATTEMPT` — attributable to the address or recipient
- `MANUAL_ADJUSTMENT_BY_OPS` — anything else, written reason required

"The rider covered more ground than expected" is not on that list and never
will be. That is a modelling error, it goes to calibration, and GoldPlus
absorbs it.

**Non-negotiable:**

- Variance inside the absorption threshold is absorbed silently. Customer not
  contacted
- Above it, ops contact the customer and get agreement before dispatch or
  redelivery. Never after handover
- The rider has no authority over the amount. The cash-on-delivery figure on
  the delivery card is what is collected, full stop. A rider discrepancy is a
  note for ops, never a change
- Every variance writes old fee, new fee, reason, actor, timestamp and
  agreement to the order audit
- A customer declining a variance may cancel without penalty
- No variance is ever silent

All three strings are editable in the Control Centre with a live preview.

---

# PART 6. The Control Centre

With twenty orders of history, every number will start wrong. So correction
speed is the design goal, and this is the primary correctness mechanism, not an
admin convenience.

One surface. Not settings scattered across the back office.

**Three tiers, each field shows which.**

- **Tier 1, one approver.** The six launch numbers, the on-time target, the
  absorption threshold, pickup hours, hub landmarks, and every customer-facing
  string including all three disclaimer stages
- **Tier 2, maker and checker.** An area's corridor, band, access mode or
  serviceability. Origin coordinates. Adding or deactivating an origin.
  Accepting a recalibration proposal that moves a fee beyond the cap
- **Tier 3, code only, absent from the UI.** The equation, the shrinkage rule,
  the band edges, the percentile logic, the variance reason codes, the
  guardrails in PART 8. If someone asks for one of these through the
  interface, the answer is a ticket

**A registry, and the UI generates from it.** Every editable value declared
once in code with type, unit, range, validation, plain label, help text and its
reader. A key outside the registry cannot be written, which is what stops the
settings table becoming a junk drawer. An entry with no reader is flagged by
the build. `docs/delivery/CONFIGURATION.md` generates from it and is never
hand-maintained.

**Draft, mandatory preview, publish.** No change takes effect from typing.
Preview runs the draft against recent real orders and named test addresses
covering every zone, corridor and band, showing old, new and difference for
each, above a plain-language impact summary. Publish needs a reason, creates an
immutable version, can be scheduled to a future East Africa Time, and reverts
in one action.

**Validation makes bad states unreachable.** Typed fields with units shown,
never free text. Ranges from the registry. Cross-field rules: no fee below its
minimum, no threshold below the fee it cancels, no zero absorption threshold,
no cutoff that is not a real time of day.

**Bulk edit by CSV round trip** in the shape of
`goldplus_delivery_corridors.csv`, with a dry run showing every changed and
failing row, landing as one versioned change.

**Proposals, not applications.** Recalibration output arrives here with sample
size and fee impact. Every live value shows whether a human set it or the model
proposed it.

**Built for ops, not engineers.** No jargon: "what we pay a rider per minute",
not `rider_cost_per_minute`. UGX with separators. East Africa Time with the
zone shown. One sentence of help per field. Alias-aware area search so someone
can type Najjera. Usable from a phone.

Guard strings from the `PERMISSIONS` vocabulary. Read, propose and publish are
three separate rights. Applying a variance to a placed order is its own
permission.

---

# PART 7. Phases

## Phase 1. Ship this.

1. Audit, origin test, baseline
2. Schema, and import of the four files with row-count assertions of 1, 362,
   28 and 84
3. The single minutes model with all learned factors at 1.0, shrinkage, and the
   six launch values
4. Fee and window from that one model, with the refusals in 3.6
5. Quote caching for consistency across product page, cart and checkout, and
   the free delivery threshold ordering rule with all three orderings tested
6. The quote commitment per PART 5, including rider card immutability
7. Name collision handling per PART 8, with a test per class
8. Customer surfaces: fee and window at product, cart and checkout, cutoff
   countdown, free-delivery progress, narrowing window after placement, missed-
   window message, pin nudge, pickup alongside every quote
9. Capture layer for calibration inputs
10. Nightly calibration jobs and the variance and margin reports
11. The Control Centre per PART 6
12. Shadow mode, comparison report, staged cutover per area, one-command revert

## Phase 2. Only when data unlocks it. Do not build now.

| Feature | Unlocks at |
|---|---|
| OpenStreetMap centroid enrichment | Only if delivered pins prove insufficient after a defined volume |
| Carrier rate cards for upcountry | First sustained upcountry order volume |
| Corridor dispatch batching | Enough same-corridor same-day orders to batch |
| Rain adjustment to the window | A season of weather-tagged delivery data |
| A cheaper slower delivery option | Batching live and its saving measured |
| A second origin | A second location exists |

Tell me when a phase 2 trigger fires. Do not build ahead of it.

---

# PART 8. Guardrails and known traps

**Corrections to my earlier briefs, apply first.**

- Retire `goldplus_locations_seed.sql`. It creates a conflicting `ug_area`
  shape and must never run. The CSVs are the only import path
- Authoritative column names are the CSV headers: `alias_or_missing_name`,
  `issue_type`. Where a brief of mine disagrees with a header, the header wins
- Never gate a required behaviour behind a confirmation from me. Area groups
  are required; derive, seed, and tell me what you seeded
- `search_text` indexes every level of the hierarchy, not just area and
  district. Entebbe was unsearchable because it exists only as a county over
  Central, Katabi, Kigungu and Kiwafu Wards
- Keep the district spelling-variant map derived from the diff against
  `UGANDA_DISTRICTS`. Never hand-typed

**Name collisions.** `uganda_name_collisions.csv` holds 84 in three classes: 38
areas carrying a different district's name, 18 sub-counties doing the same, 28
areas sharing their own district's name. A bare single-token query matching a
district name resolves to the district and never auto-selects a same-named area
elsewhere. The Kampala to Sembabule mis-route was one of these. Any
collision-resolved address is a candidate for the variance path.

**The corridor file is a prior, not a price list.** No area was assigned by
measuring a distance. Bands were assigned by judgement, 200 rows at area level
and 162 inherited from sub-county. When measured centroids arrive, some areas
will sit outside their band. Expected. Reband on evidence. Never show a band
boundary to a customer as a distance.

**Never:**

- Substitute a default for a missing configuration value
- Let a coefficient change alter a placed order
- Let the fee differ across product page, cart and checkout for one basket
- Change a placed fee for a reason outside the PART 5 list
- Let a rider alter a collected amount
- Pass a modelling error to the customer
- Call an external geocoder on the request path
- Present a point-in-time delivery promise
- Compute the cutoff in anything but East Africa Time
- Hardcode a factor, a multiplier or a disclaimer string
- Write a configuration value outside the registry
- Publish without a preview against real orders
- Expose a Tier 3 value in the UI
- Let one person propose and publish the same Tier 2 change
- Build two quoting services
- Build a phase 2 feature before its trigger fires

---

# PART 9. Definition of done, phase 1 only

**Model**

1. Fee and delivery window derive from one expected-minutes calculation and
   cannot disagree
2. The module returns quotes once the six launch values are set, and
   `fee_unavailable` before that
3. Every learned factor ships at 1.0 and its sample size is visible in admin
4. Shrinkage is one formula applied to every learned value, with no
   per-parameter special cases
5. A measured centroid overrides a band midpoint, and the quote records which
   was used
6. The window is derived from observed percentiles and tunes itself to the
   on-time target
7. No computed quote for a non-metro area, an unserviceable area, or any of the
   12 water areas
8. No quote when no active origin exists, proven by deactivating it
9. No metro area and no active alias without a corridor and band

**Origin and data**

10. Origin loads corrected and passes the Uganda bounding box test
11. Dispatch instructions carry both landmarks, Uhuru Restaurant first
12. All four files import with assertions passing, and re-running changes
    nothing
13. `goldplus_locations_seed.sql` is retired and cannot execute
14. A bare query matching a district name resolves to the district, with a test
    per collision class

**Commitment**

15. The three disclaimer stages appear in the right places and are editable
    with preview
16. A placed fee cannot change for a reason outside the list, proven by a test
    that tries
17. Variance inside the threshold is absorbed silently; above it needs recorded
    agreement before dispatch
18. The cash-on-delivery amount on the rider card equals the order total and no
    rider path can change it
19. Every variance writes old, new, reason, actor, timestamp and agreement to
    the audit

**Customer surface**

20. Same basket, same fee, at product page, cart and checkout
21. Cutoff countdown correct in East Africa Time across a day boundary and a
    weekend
22. Free-delivery progress exact, with the threshold ordering rule explicit and
    all three orderings tested
23. Pickup from Wilson Road shown alongside every quote with hours and both
    landmarks
24. Pin nudge live, and its effect on last-mile minutes measurable
25. A customer who will miss their window is messaged before they ask

**Control Centre**

26. Every editable value is in the registry, the UI generates from it, and a
    key outside cannot be written
27. No publish without a preview against real orders and an impact summary
28. Tier 2 needs a second person; no Tier 3 value appears in the UI
29. Corridor table exports, re-imports with a dry run, lands as one versioned
    change
30. Every live value shows whether a human set it or the model proposed it
31. A change schedules to a future time and reverts in one action
32. `docs/delivery/CONFIGURATION.md` generates from the registry
33. An ops team member finds an area by typing Najjera, changes its band,
    previews and publishes, without a developer

**Rollout**

34. The existing predictor is baselined and the new engine runs in shadow
    before pricing anything
35. Cutover is per area on shadow evidence, logged, attributed, revertible in
    one command
36. Exactly one quoting service exists at the end
37. Any order's quote is fully explainable in admin: origin, centroid source,
    corridor, band, factors, sample sizes, configuration version and any
    variance

---

# PART 10. Decisions reserved for Rob

Six values to launch, from `MODEL.md` PART 3.3. Then four more, none of which
block go-live:

1. The on-time rate target the window tunes itself to
2. The variance absorption threshold, as a percentage and an absolute amount
3. The cap on how far one recalibration may move a fee
4. Which roles hold read, propose and publish on each tier

Everything else that was a decision in earlier versions is now either learned
from data or a phase 2 trigger. If you find a seventh launch number or a fifth
decision, you have modelled something that should have been fitted.
