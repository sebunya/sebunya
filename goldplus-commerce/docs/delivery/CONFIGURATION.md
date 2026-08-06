# Delivery configuration

> GENERATED FROM `DeliveryConfigRegistry.ts`. Do not hand-edit — run
> `npx tsx src/scripts/generate-delivery-configuration-doc.ts`. A test asserts
> this file matches the registry, so drift fails the build rather than
> quietly misleading whoever reads it next.

A key outside this registry cannot be written. That is what stops the
settings table becoming a junk drawer.

**5 mandatory launch values**, plus `own_rider_max_band`, gate quoting.
Everything else is optional and its absence produces a weaker, honest
promise rather than a default.

## Tier 1 — one approver

| Key | Type | Unit | Ships as | Range | What it is |
|---|---|---|---|---|---|
| `effective_speed_kmh` **(required)** | number | km/h | **unset** | 1 to 120 | How fast a rider actually covers ground |
| `rider_cost_per_minute_ugx` **(required)** | number | UGX per minute | **unset** | 0.01 to 100000 | What we pay a rider per minute |
| `handling_minutes` **(required)** | number | minutes | **unset** | 0 to 600 | Minutes from order confirmed to rider leaving |
| `margin_multiplier` **(required)** | ratio | × | **unset** | 1 to 10 | What goes on top of cost |
| `minimum_fee_ugx` **(required)** | ugx | UGX | **unset** | 0 to 10000000 | The lowest delivery fee we will charge |
| `free_delivery_threshold_ugx` | ugx | UGX | **unset** | 0 to 100000000 | Order value that earns free delivery |
| `fee_to_value_ratio_ceiling` | ratio | × the order value | **unset** | 0.01 to 100 | Warn when delivery costs more than this share of the order |
| `min_order_value_own_rider_ugx` | ugx | UGX | **unset** | 0 to 100000000 | Smallest order worth sending a rider for |
| `min_order_value_bus_parcel_ugx` | ugx | UGX | **unset** | 0 to 100000000 | Smallest order worth shipping by bus |
| `parcel_capacity_small_items` | integer | items | **unset** | 1 to 1000 | Items that fit in one small parcel |
| `parcel_capacity_medium_items` | integer | items | **unset** | 1 to 1000 | Items that fit in one medium parcel |
| `parcel_capacity_large_items` | integer | items | **unset** | 1 to 1000 | Items that fit in one large parcel |
| `fee_rounding_step_ugx` | ugx | UGX | `500` | 1 to 100000 | Round the fee up to a multiple of |
| `implausible_rider_cost_ugx` | ugx | UGX | `5000000` | 1000 to 100000000 | Reject a rider cost above |
| `plausible_speed_min_kmh` | number | km/h | `8` | 1 to 120 | Warn if a derived speed is below |
| `plausible_speed_max_kmh` | number | km/h | `45` | 1 to 120 | Warn if a derived speed is above |
| `same_day_cutoff_eat` | string | HH:MM East Africa Time | **unset** | — | Same-day dispatch cutoff |
| `window_min_sample_size` | integer | deliveries | **unset** | 1 to 10000 | Deliveries needed before we promise an hour window |
| `calibration_min_sample_size` | integer | deliveries | **unset** | 1 to 10000 | Deliveries needed before the model may propose a change |
| `on_time_target_bps` | integer | basis points | **unset** | 1 to 10000 | How often a delivery must land inside its window |
| `variance_absorption_threshold_ugx` | ugx | UGX | **unset** | 0 to 10000000 | Fee difference we absorb without contacting the customer |
| `variance_absorption_threshold_bps` | integer | basis points | **unset** | 0 to 10000 | Or, as a share of the fee |
| `recalibration_fee_move_cap_bps` | integer | basis points | **unset** | 0 to 10000 | Most one recalibration may move a fee |
| `copy_estimate_stage1` | string | — | `Estimated from your area. Your exact delivery fee is confirm` | — | Before we know the area |
| `copy_fixed_stage2` | string | — | `This delivery fee is fixed for this order. It can only chang` | — | At checkout and on the confirmation |
| `copy_unavailable_config_incomplete` | string | — | `We are finalising delivery pricing for your area. Place your` | — | When our pricing is not set up yet |
| `copy_unavailable_no_active_origin` | string | — | `We cannot quote delivery right now. Place your order and our` | — | When no dispatch point is active |
| `copy_unavailable_area_unserviceable` | string | — | `We are not able to deliver to this area at the moment. You a` | — | Area we do not serve |
| `copy_unavailable_water_access` | string | — | `This address is reached by boat, so we cannot deliver there ` | — | Lake-access areas |
| `copy_unavailable_area_unresolved` | string | — | `We could not match your address to an area. Place your order` | — | Address did not resolve |
| `copy_pickup_offer` | string | — | `Collect free from GoldPlus, Wilson Road — next to Uhuru Rest` | — | Pickup offer |
| `copy_unavailable_area_too_coarse` | string | — | `We found your district. Choose the specific area you are in ` | — | District known, area not yet chosen |
| `copy_variance_agreement_request` | string | — | `Your delivery address turned out to be in a different area f` | — | Asking a customer to agree a changed fee |
| `copy_carrier_required` | string | — | `We ship to your area by bus. Your parcel travels to a parcel` | — | Served by bus rather than by our rider |
| `copy_unavailable_no_rate_card` | string | — | `We ship to your area by bus, but we do not have a current pr` | — | Bus-served, no current rate card |
| `copy_fee_exceeds_value` | string | — | `Getting this to you costs more than the items in your basket` | — | Delivery costs more than the goods |
| `copy_below_minimum_order` | string | — | `This order is below our minimum for this destination. You ca` | — | Order below the minimum for its destination |
| `copy_unavailable_parcel_class_unknown` | string | — | `We ship to your area by bus. Place your order and our team w` | — | Shipping class not set for something in the basket |
| `copy_parcel_count_notice` | string | — | `Bus parcels are charged per parcel, so a larger order can sh` | — | Explaining per-parcel charging |
| `copy_pin_nudge` | string | — | `Drop a location pin so our rider can find you first time.` | — | Location pin request |

## Tier 2 — maker and checker

| Key | Type | Unit | Ships as | Range | What it is |
|---|---|---|---|---|---|
| `own_rider_max_band` **(required)** | string | distance band | **unset** | B0 / B1 / B2 / B3 / B4 / B5 / B6 | How far out our own rider goes |

## Help text, as an operator sees it

- **How fast a rider actually covers ground** (`effective_speed_kmh`) — Average speed on a real run, including traffic and stops — not the speed limit. One typical Ntinda round trip is enough to work it out.
- **What we pay a rider per minute** (`rider_cost_per_minute_ugx`) — What a rider is paid for a delivery, divided by how many minutes it takes. Kept to the decimal, because it is a rate rather than a price.
- **Minutes from order confirmed to rider leaving** (`handling_minutes`) — Picking, packing and handing over. Not travel time.
- **What goes on top of cost** (`margin_multiplier`) — 1.0 charges exactly what the delivery costs us. 1.3 adds thirty percent.
- **The lowest delivery fee we will charge** (`minimum_fee_ugx`) — Below this a delivery is not worth doing. Applied after rounding, so it is always respected.
- **Order value that earns free delivery** (`free_delivery_threshold_ugx`) — Optional. Ships off. Tested against the goods total AFTER promotional discounts and BEFORE loyalty points are applied, because points are tender rather than a price change.
- **How far out our own rider goes** (`own_rider_max_band`) — Anywhere further than this is shipped by bus to a parcel office instead. Set it by naming the furthest place you would send your own rider.
- **Warn when delivery costs more than this share of the order** (`fee_to_value_ratio_ceiling`) — A 35,000 delivery on a 20,000 cable is a broken proposition, not an expensive delivery. Above this we say so plainly, offer collection, and let the customer choose it anyway on purpose. It never blocks the sale. Unset means the check is off.
- **Smallest order worth sending a rider for** (`min_order_value_own_rider_ugx`) — Below this we tell the customer the minimum and how far off it they are. It never blocks the sale. Unset means no minimum.
- **Smallest order worth shipping by bus** (`min_order_value_bus_parcel_ugx`) — A bus parcel has a floor cost whatever is in it. Below this we say what the minimum is. It never blocks the sale. Unset means no minimum.
- **Items that fit in one small parcel** (`parcel_capacity_small_items`) — Above this the order ships as more than one parcel, and each parcel is charged. Unset means a multi-item small basket goes to the manual queue rather than guessing how many fees to charge.
- **Items that fit in one medium parcel** (`parcel_capacity_medium_items`) — Above this the order ships as more than one parcel, and each parcel is charged. Unset means a multi-item medium basket goes to the manual queue rather than guessing how many fees to charge.
- **Items that fit in one large parcel** (`parcel_capacity_large_items`) — Above this the order ships as more than one parcel, and each parcel is charged. Unset means a multi-item large basket goes to the manual queue rather than guessing how many fees to charge.
- **Round the fee up to a multiple of** (`fee_rounding_step_ugx`) — A quote of 4,317 is unusable in a cash market and a rider needs to make change. Applied after the margin and before the minimum fee.
- **Reject a rider cost above** (`implausible_rider_cost_ugx`) — A single delivery costing more than this is a typo, not a delivery. Raise it if a genuine long-haul run ever costs more.
- **Warn if a derived speed is below** (`plausible_speed_min_kmh`) — Only a warning on the setup wizard. It never changes a fee and never blocks a publish.
- **Warn if a derived speed is above** (`plausible_speed_max_kmh`) — Only a warning on the setup wizard. It never changes a fee and never blocks a publish.
- **Same-day dispatch cutoff** (`same_day_cutoff_eat`) — Orders placed before this time in Kampala go out the same day. Unset means no same-day promise is made at all.
- **Deliveries needed before we promise an hour window** (`window_min_sample_size`) — Until an area has this many completed deliveries we promise at day level — today, tomorrow — rather than inventing an hour range. Unset means day level everywhere.
- **Deliveries needed before the model may propose a change** (`calibration_min_sample_size`) — Below this the nightly job reports "not enough data" instead of a proposal, and the queue refuses to accept one. Unset means no proposals are made at all.
- **How often a delivery must land inside its window** (`on_time_target_bps`) — The window widens by itself until it hits this. Unset means no hour window is offered at all, because there is nothing to tune against.
- **Fee difference we absorb without contacting the customer** (`variance_absorption_threshold_ugx`) — Below this we absorb silently. Above it, ops must agree the change with the customer before dispatch.
- **Or, as a share of the fee** (`variance_absorption_threshold_bps`) — Whichever of the two thresholds is reached first.
- **Most one recalibration may move a fee** (`recalibration_fee_move_cap_bps`) — A proposal that moves a fee further than this needs a second approver.
- **Before we know the area** (`copy_estimate_stage1`) — Shown on the product page and in the cart, before a delivery area is chosen.
- **At checkout and on the confirmation** (`copy_fixed_stage2`) — The last sentence is a control, not copy. It prevents the most common failure in this market.
- **When our pricing is not set up yet** (`copy_unavailable_config_incomplete`) — Shown when the launch values have not been entered. The customer has done nothing wrong and the order still completes.
- **When no dispatch point is active** (`copy_unavailable_no_active_origin`) — An internal fault. Say nothing about the cause, and never quote a default.
- **Area we do not serve** (`copy_unavailable_area_unserviceable`) — No quote at any price. Offer pickup and a different address.
- **Lake-access areas** (`copy_unavailable_water_access`) — The 12 water areas are pickup-only. No surcharge, no road quote.
- **Address did not resolve** (`copy_unavailable_area_unresolved`) — A data gap never blocks a sale — the order completes through the manual path.
- **Pickup offer** (`copy_pickup_offer`) — Shown alongside every quote. Uhuru Restaurant first, Pioneer Mall as the wider fallback.
- **District known, area not yet chosen** (`copy_unavailable_area_too_coarse`) — NOT a refusal — the address resolved correctly, it is simply not precise enough to price. The interface offers the areas in that district. Never fall back to a district average: there is no such thing.
- **Asking a customer to agree a changed fee** (`copy_variance_agreement_request`) — Sent only when the change is above the absorption threshold. Below it we absorb the difference silently.
- **Served by bus rather than by our rider** (`copy_carrier_required`) — Never reads as a refusal: the customer IS served. Say shipment and collection, never delivery to the door.
- **Bus-served, no current rate card** (`copy_unavailable_no_rate_card`) — A fact about us, not the customer — a carrier negotiation nobody has closed. It appears in an ops queue so somebody knows.
- **Delivery costs more than the goods** (`copy_fee_exceeds_value`) — Shown with the exact basket value that would make it proportionate. Never blocks the sale and never the pre-selected option.
- **Order below the minimum for its destination** (`copy_below_minimum_order`) — Informative, never a block, and shown with the minimum and the shortfall.
- **Shipping class not set for something in the basket** (`copy_unavailable_parcel_class_unknown`) — A gap in OUR product data, never the customer's fault, so the sentence says nothing about it. Ops sees the real cause in the manual queue.
- **Explaining per-parcel charging** (`copy_parcel_count_notice`) — Shown with the parcel count BEFORE the customer commits. Two parcels is two fees, and a surprise there is a dispute.
- **Location pin request** (`copy_pin_nudge`) — Deliberately makes NO claim about time saved. No delivery has been completed with a pin yet, so any number would be invented. Add the claim here once the split is measured.
