# Delivery Estimation — decisions and assumptions log

Dated as taken. PART 10 decisions stay unset and do not block; the module says
so rather than defaulting.

---

## Resolved by Rob, 2026-08-05 (PART 2 approval)

**Corridor file columns.** An earlier draft of PART 8 conflated two columns.
The file is authoritative: `assignment_basis` = area_level **182** /
sub_county_level **180**; `assignment_confidence` = high **200** / medium
**162**. `OPERATIONS.md` amended.

**The old band scheme is retired, not mapped.** CORE/CITY/METRO/METRO_EDGE/
NEAR/MID/FAR/REMOTE (edges 6/12/25/45/160/340/520/∞ km) does not map to
B0–B6 (0–2/2–5/5–9/9–15/15–25/25–45/45–70 km) and no mapping will be attempted.
B0–B6 replaces it. Consolidation is two fee paths into one.

**Shadow mode dropped.** With 18 orders, none delivered, and the old model
returning nothing on 11 of 18, a shadow comparison cannot teach anything it
costs. Direct cutover of the metro set once stage B is green; the old path is
kept only as a fallback for what the new engine refuses; the stage D variance
report is the safety net; one-command revert stays.

**Rider cost capture moved to stage A.** It is recorded nowhere today, which
makes the whole PART 4 learning design dead unless capture exists from the
first delivery. Schema field plus an ops entry path is stage A work.

**East Africa Time moved to stage A.** It is a primitive, not a feature. The
cutoff countdown, the delivery window, the scheduled publish and every
timestamp comparison sit on it. Built as a utility with its own day-boundary
and weekend tests before anything uses it.

**Free delivery threshold ordering — SPECIFIED.** Previously undefined (the
field existed and was read by nothing).

> The threshold tests the merchandise subtotal **after** promotional discounts
> and **before** loyalty point redemption.

Reasoning, recorded because it will be questioned later: a promotion changes
the price of the goods, so it belongs in the subtotal. Loyalty points are
**tender, not a price change**, so they apply after the threshold is
evaluated. This prevents the failure where a customer crosses the threshold,
redeems points, and silently drops back under it.

Implemented as the configurable default. All three orderings are tested so an
alternative can be selected later without a rewrite.

---

## Resolved by Rob, 2026-08-05 (stage B and stage C approvals)

**Machine-readable causes for `fee_unavailable`.** One state cannot serve six
situations. Seven reason codes, each with its own Tier 1 string and its own ops
queue. See `MODEL.md` 3.7.

**Rounding order.** Round up to the step **after** the margin and **before** the
minimum-fee floor, so the floor always wins. Raw, step and rounded are recorded
separately in the quote explanation.

**No hour window until there is a sample.** Day level falls out of two unset
values — the on-time target and the minimum sample — rather than a threshold
anyone invented. Nothing is widened to look cautious.

**No time-saving claim on the pin nudge.** Zero deliveries have completed with
a pin, so the with/without split cannot be fitted and any number would be
invented. The claim is added later, from data, as a Tier 1 string.

**`AREA_TOO_COARSE` added (stage C).** A district-only resolution is correct and
unpriceable. Not a refusal; routes to address review, not manual quoting.

**The cache key includes the configuration version.** Every cached
`CONFIG_INCOMPLETE` must die the moment the launch numbers land, or it will look
as though they did not take. Versioning the key invalidates everything
atomically, with no sweep and no reasoning about which keys affect which quotes.

**The 5,000,000 typo ceiling became `implausible_rider_cost_ugx`,** Tier 1, same
treatment as the 500 rounding step. The remaining literals in the delivery code
are Uganda's bounding box, the earth radius and `SHRINKAGE_PSEUDO_COUNT` — two
structural, one Tier 3 by the brief.

**Skipped lifecycle mirrors surface in the ops queue.** Each one is an
observation the model never gets. Read from the audit rather than duplicated, so
the queue and the audit cannot disagree. Not fatal, never auto-retried.

---

## Stage D decisions, 2026-08-06

**Unlearned is not fitted-to-1.0.** A factor with no observations is *undefined*.
It computes identically to 1.0 — that is what a prior is for — but it is a
different fact and must never display as the same thing. Carried as
`origin='prior' sample_size=0` against `origin='fitted'` with a real sample, and
kept distinguishable in the store, the admin display and every export.

**No proposal below the minimum sample.** The nightly job emits
`insufficient_data` rather than a proposal carrying a small number, and the
queue *refuses* acceptance below the minimum rather than warning about it. Not
relying on an operator noticing a sample size of two.

**The minimum sample size is Tier 1 and ships unset,** the same treatment as
`window_min_sample_size`. Shipping a figure would make it a launch number in
disguise. Its absence means **no proposals at all** — which is honest, because
with zero observations there is nothing to propose anyway.

**Recompute statelessly from full history.** Each nightly run refits every
factor from all observations, never incrementally from the last run. Slower and
self-correcting: a bad night fixes itself and running twice changes nothing.

**No synthetic data may reach production.** Calibration fixtures live in tests
only. No seed migration, no dev-only INSERT — the same rule that keeps migration
0092 free of INSERTs, pinned the same way.

---

## Commercial constraint, 2026-08-06 — fulfilment modes and bus

Rob established a constraint that changes the model. Recorded in full because it
corrects a **fact**, not a preference.

**The fee must never exceed the value of what is being bought.** Quoting 35,000
to ship a 20,000 cable is a broken proposition, not an expensive delivery.
`fee_to_value_ratio_ceiling`, Tier 1, ships unset. Above it the option is
demoted and explained with the exact basket value that would make it
proportionate, collection is offered, and the customer may still proceed with an
explicit acknowledgement — never the default, never silent, **never a block**.

**Upcountry goes by bus, not by boda.** Outside Kampala and the Wakiso metro it
is not physically possible to send a rider. Bus was wrongly scheduled as phase
two; it is the only way those customers are ever served. Three of the eighteen
real orders — Arua, Abim, Adjumani — could not be served by any path in the
system before this.

**Fulfilment mode is first-class.** `own_rider`, `bus_parcel`, `pickup_only`,
`unserviceable`. The mode SELECTS the pricing mechanism rather than being a flag
a pricing function checks.

**Computed pricing is unreachable outside own-rider range.** Not guarded —
deleted. `quoteDelivery` takes `OwnRiderArea`, a type that cannot carry a bus,
water or unserviceable state, so those branches no longer exist inside it. The
56,000 UGX six-hour round trip is not a number we chose not to show; it is a
number that function can no longer be asked for.

**`own_rider_max_band` is mandatory, Tier 2, and ships unset.** Unset means we
do not know where rider service ends, so NOTHING is classified `own_rider` —
not that everything is. It is **not a seventh launch number**: it is a band
rather than a figure, it is Tier 2 rather than Tier 1, and the wizard asks for
it as a PLACE ("the furthest place you would send your own rider"), deriving the
band from the gazetteer. Derived from an operator's knowledge, never invented.
The wizard refuses a limit nearer than the anchor trip just described.

**Bus is a shipment to a parcel office, not a delivery.** The customer-facing
language says shipment and collection and never "delivery to your door", because
that is not what happens and promising it creates the dispute. A test asserts
the sentence contains no delivery-to-door claim.

**Bus pricing is a negotiated rate card, never a model.** Two prohibitions, both
tested: a destination with no current card returns `NO_RATE_CARD` rather than
borrowing the next town's fee, and a missing parcel class is never interpolated
from the class above or below. An expired card is never a fallback. Insurance
with no declared value is null, not zero — a carrier offering no cover is a
different fact from cover at zero percent.

**Minimum order value per mode**, Tier 1, unset by default. Informative only: a
basket below the minimum is told the minimum and the shortfall. Deliberately
does NOT require an acknowledgement — making someone tick a box because their
order is small would be a dark pattern.

### Two new reasons, one retirement

| Reason | Meaning | Routes to |
|---|---|---|
| `CARRIER_REQUIRED` | Served, by bus rather than by our rider | the shipment flow |
| `NO_RATE_CARD` | Bus-served, no current card covers it | manual quote + ops queue |

**`AREA_NOT_METRO` is RETIRED**, union entry and copy string both. It told an
Arua customer where they were *not*. Nothing can produce it any more, so it is
gone rather than left as a reason with no path to it.

### The template

`goldplus_bus_rate_card_template.csv`, MD5 `272c26454ac8aba9fdd748b095722476`,
128 towns across 9 trunk routes, **every fee column deliberately blank**.
Imported as the destination and office skeleton only; the importer REFUSES to
run if any fee column is populated, so a negotiated price can never arrive as a
side effect of a skeleton load.

- 2026-08-06 — **Mubende appears on two routes** (R7 mid-western and R8
  Hoima/Masindi) because two trunk roads reach it. The key is therefore
  `(route, destination_town)` and NOT the district; a district key would have
  silently dropped one and nobody would have noticed until a Mubende customer
  got the wrong carrier.

- 2026-08-06 — **Zero rate cards exist.** Every bus destination therefore
  returns `NO_RATE_CARD` and the manual path handles it. That is correct, and no
  fee has been invented to make the table look complete.

---

## Assumptions (dated)

- 2026-08-05 — **Origin coordinate is approximate pending on-site capture.**
  `coord_source=operator_supplied_dms_converted`,
  `coord_confidence=approximate_adjacent_landmark`, anchored on Uhuru
  Restaurant (adjacent premises). Must become `onsite_capture` before go-live.
  The bounding-box test guards the conversion class, not the precision.

- 2026-08-05 — **The 11 previously unpriced orders resolve 11/11**, through the
  gazetteer's alias-aware search and district probe, with no special-case
  mapping written. Eight are Kampala metro parishes and become priceable; three
  are **not Kampala at all** — Esia→Adjumani, Atunga→Abim, Lazebu→Arua — and
  are correctly refused to the manual path as upcountry. The old model would
  have priced none of them; had their district field been populated it would
  have mispriced the three as metro.

- 2026-08-05 — **Coverage, not accuracy.** Baseline 7/18 priced (39%). New
  engine 15/18 priceable (83%), 3/18 correctly refused. There is no accuracy
  baseline because no order has ever been delivered and no rider cost exists.
  *Any later claim of improvement states plainly that it started from zero
  observations.*

- 2026-08-05 — **Ntenjeru water group needs operator verification** before
  go-live: Mpatta, Mpunge, Ssaayi, Kabanga (Mukono) are flagged
  `access_mode=water` but may be road-reachable, unlike Koome Islands, Bussi,
  Zzinga, Zzinba and Bunjako which are confidently water. All 12 are
  pickup-only in phase 1 either way.

- 2026-08-05 — **`Busanga` appears twice in different senses.** The collisions
  and water sets contain Busanga (Koome Islands, Mukono); the location module's
  negative trap keeps "bunga" from matching a different Busanga. Unrelated
  places with the same name — worth knowing when reading collision output.

---

## PART 10 — reserved for Rob, unset, non-blocking

| # | Decision | State |
|---|---|---|
| — | The six launch numbers (`MODEL.md` 3.3) | **UNSET** — module returns `fee_unavailable` until all six are set |
| 1 | On-time rate target the window tunes to | UNSET |
| 2 | Variance absorption threshold (% and absolute) | UNSET |
| 3 | Cap on how far one recalibration may move a fee | UNSET |
| 4 | Roles holding read / propose / publish per tier | UNSET |

None of these default. Each is surfaced as "not set" with the consequence
stated.
