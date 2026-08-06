# GoldPlus Delivery Estimation — the model

> Build brief version 7, PARTS 3 and 4. The contract these serve is in
> `CONTRACT.md`. Operations and rollout are in `OPERATIONS.md`.

---

# PART 3. The model

## 3.1 One equation

```
expected_minutes =
      handling_minutes
    + travel_minutes(area, hour_of_day, day_of_week)
    + last_mile_minutes(area, has_pin, landmark_quality)

quoted_fee = max(
      minimum_fee,
      rider_cost_per_minute × expected_minutes × margin_multiplier
    )

delivery_window = observed percentiles of expected_minutes
                  for that area, corridor, band and hour
```

Fee and window come from the same number. Do not build two models.

## 3.2 Travel minutes, and where the priors come from

```
travel_minutes = (round_trip_km / effective_speed_kmh) × 60 × corridor_factor × hour_factor
round_trip_km  = band_midpoint_km × 2 × detour_factor
```

Band midpoints are arithmetic on the published band edges, not judgement:

| Band | Edges (km) | Midpoint | Round trip |
|---|---|---|---|
| B0 | 0 to 2 | 1.0 | 2.0 |
| B1 | 2 to 5 | 3.5 | 7.0 |
| B2 | 5 to 9 | 7.0 | 14.0 |
| B3 | 9 to 15 | 12.0 | 24.0 |
| B4 | 15 to 25 | 20.0 | 40.0 |
| B5 | 25 to 45 | 35.0 | 70.0 |
| B6 | 45 to 70 | 57.5 | 115.0 |

`corridor_factor`, `hour_factor` and `detour_factor` all start at 1.0 for every
value. They are never set by hand. They are fitted from observed deliveries in
PART 4. A factor still at 1.0 means we have not learned anything about that
corridor or hour yet, which is true and should be visible in admin.

**Sharpened 2026-08-06 (stage D rule 1): unlearned is not the same as fitted to
1.0.** Both compute identically — that is the point of the prior — but they are
different facts and must never be displayed as the same thing. A factor with no
observations is *undefined*, carried as `origin='prior'` with `sample_size=0`. A
factor that evidence put at 1.0 is `origin='fitted'` with a real sample. The
store, the admin display and every export must keep them distinguishable.

Where a measured centroid exists, `round_trip_km` uses the real straight-line
distance instead of the band midpoint, times the detour factor. A measured
value always beats a band midpoint.

## 3.3 The six launch numbers

These are the only values that must be set before the module goes live. Every
one is something the shop already knows.

| Key | Unit | How to get it |
|---|---|---|
| `effective_speed_kmh` | km/h | Derivable from one typical run. Or give a typical Ntinda round trip in minutes and derive it |
| `rider_cost_per_minute` | UGX | What a rider is paid, divided by the time it takes |
| `handling_minutes` | minutes | Order confirmed to rider leaving the shop |
| `margin_multiplier` | ratio | What goes on top of cost |
| `minimum_fee` | UGX | The floor below which a delivery is not worth doing |
| `free_delivery_threshold` | UGX | Optional. Ships off |

**Five of the six are mandatory.** `free_delivery_threshold` is the sixth
number in the list and is explicitly optional — it ships off, and unset means
the mechanic is off rather than everything qualifying. So `LAUNCH_KEYS` in code
holds five keys, which is the same statement as "six numbers, one optional",
not a disagreement with it.

Until all five mandatory values are set, the module returns `fee_unavailable`
and the manual path handles the order. Unset launch values are a message on an
admin dashboard, not a blocker for a whole build.

Every other parameter in this module is learned. If you find yourself asking me
for a seventh number, you have modelled something that should have been fitted.

## 3.4 Learning, and the cold start

Twenty orders of history is not enough to fit anything. So every learned value
shrinks toward its prior, with the weight moving to observed data as the sample
grows.

- An area with no deliveries uses its corridor's factor. A corridor with none
  uses 1.0
- An area with three deliveries is mostly still its corridor, nudged
- An area with fifty is mostly itself
- The shrinkage is one formula applied everywhere. Do not write per-parameter
  special cases

Show sample size next to every learned value in admin. A team member should
always be able to see whether a number is evidence or a placeholder.

## 3.5 Where centroids come from

In precedence order, better always overwrites worse:

1. **Delivered order pins.** Median of customer GPS pins on delivered orders
   for that area, recomputed nightly, with a minimum sample. Better than any
   gazetteer because it describes where customers are rather than where a
   boundary sits. This makes the location module's pin capture pay twice
2. **Manual placement** by ops for a high-volume area, attributed and audited
3. **Band midpoint.** The fallback in 3.2

OpenStreetMap enrichment is phase 2. Delivered pins will beat it and cost
nothing.

## 3.6 What the model must refuse

- Any area outside the 362-area metro corridor set gets no computed quote.
  Upcountry uses the manual path in phase 1 and a carrier rate card in phase 2.
  A Gulu order must never be priced by a model fitted on Kampala boda journeys.
  Test it
- Any area flagged unserviceable gets no quote at all, at any price
- The 12 water-access areas are pickup-only in phase 1. No surcharge, no
  coefficient, no road quote. Verify the Ntenjeru group of Mpatta, Mpunge,
  Ssaayi and Kabanga before go-live, since some may be road-reachable, unlike
  Koome Islands, Bussi, Zzinga, Zzinba and Bunjako which are confidently water
- Any quote where no active origin exists. Refuse and alert. Never a default
  coordinate
- Any metro area or active alias with no corridor and band. Make them required
  fields and test it

## 3.7 The seven reasons — added 2026-08-05, stage C

The refusals above produce six machine-readable reason codes, plus one that is
**not a refusal**. Ops and the customer both need to tell them apart, so the
list is closed and every reason owns a Tier 1 string:

| Reason | Meaning | Routes to |
|---|---|---|
| `CONFIG_INCOMPLETE` | Our launch values are not set | nobody — fixes itself when the numbers land |
| `NO_ACTIVE_ORIGIN` | Our own fault. Refuse and alert | engineering |
| `AREA_NOT_METRO` | Resolved perfectly, simply upcountry | **manual-quote queue** |
| `AREA_UNSERVICEABLE` | We do not serve it at any price | nobody — offer pickup |
| `WATER_ACCESS` | One of the 12 lake areas, pickup-only | nobody — offer pickup |
| `AREA_UNRESOLVED` | We could not match the address | **address-review queue** |
| `AREA_TOO_COARSE` | District known, area not chosen | **the customer**, in one step |

`AREA_TOO_COARSE` is the one that must not read like a refusal. "Kampala" is a
correct resolution that is merely not precise enough to price, because corridor
and band exist only at area granularity. The customer narrows to an area and
gets a fee. **Never fall back to a district-average band — there is no such
thing**, and inventing one would break contract #4.

The checks run in that order deliberately. Each question can only be asked once
the one above it is answerable: an upcountry area has no corridor row, so it
has no serviceability flag or access mode either, and calling it unserviceable
would invent a fact.

---

# PART 4. Calibration

Capture per delivery: area, alias used, corridor, band, quoted fee, final fee,
variance reason if any, actual rider cost, dispatch time, delivered time,
whether a pin was present, first-attempt success, and distance travelled if
available.

Nightly, recompute and propose:

- Area centroids from delivered pins
- `detour_factor` per corridor from actual against straight-line distance
- `corridor_factor` and `hour_factor` from observed minutes against predicted
- `last_mile_minutes` split by pin present or absent, which is what justifies
  the pin nudge to customers
- Percentile bands for the delivery window
- Variance report: how often a quote changed after placement, by reason, size,
  and what GoldPlus absorbed
- Margin report: quoted fee against actual cost per area

**Proposed, never applied.** Every recalibration lands in the Control Centre as
a proposal with its sample size and fee impact. A human accepts, edits or
rejects. A pricing model that repoints itself overnight is one nobody can
explain to a customer or an accountant.

**The window tunes itself.** Choose the percentile pair so the observed on-time
rate hits the target I set. If deliveries land late more often than allowed,
the window widens by itself until the promise holds.

**Variance is a signal, not just a cost.** High variance in an area means the
band is wrong or the address quality is poor. Route the first to a reband flag,
the second to the location module's address review queue. Falling variance over
time is the honest proof this is working.
