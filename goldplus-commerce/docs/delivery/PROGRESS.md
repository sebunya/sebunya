# Delivery module — final build progress

Live log. Written as work completes, not planned ahead. Newest at the bottom.

## Plan, in the brief's order

1. Parcel classification → LearnedFactor type gap → literal sweep
2. Wire the quoting service into checkout, CONFIG_INCOMPLETE-only fallback
3. Variance write path
4. Learning loop
5. Customer surfaces
6. Control Centre completion
7. Delete both legacy fee paths — the finish line

Then the gate: one real order end to end.

---

## 1. Parcel classification, LearnedFactor, literal sweep — done

**Shipping class**, not weight. `products.shipping_class` overrides
`categories.default_shipping_class`, and neither resolving is
`PARCEL_CLASS_UNKNOWN` → manual queue. Never defaults to small: small is the
cheapest class, so a guess under-charges and only surfaces when a carrier
refuses the parcel at the counter.

Multi-item: highest class present sizes the shipment; parcel count is
`ceil(items / capacity)` and the customer is told before committing. Capacities
are Tier 1, unset. Unset + more than one item = `PARCEL_CAPACITY_UNKNOWN`
rather than a guessed number of FEES; unset + one item = one parcel, which is
arithmetic rather than an assumption.

**LearnedFactor gap closed the OwnRiderArea way.** A `PriorFactor` has no
`value` field at all, so an unlearned factor cannot be read as a measurement.
`fittedFactor()` REFUSES a zero sample and hands back a prior, and
`factorFromRow` reads the contradiction the DB can still express
(`origin='fitted', sample_size=0`) as a prior.

The type change found a latent bug: test fixtures were passing the
MULTIPLICATIVE neutral (prior 1) to `lastMileMinutes`, which is ADDITIVE
(prior 0). It only ever computed correctly because `shrinkToward` short-circuits
on a zero sample. Now `ADDITIVE_NEUTRAL_FACTOR` is a distinct value.

**Literal sweep clean.** Every hit is a declared registry min/max, the Uganda
bounding box, the earth radius, `SHRINKAGE_PSEUDO_COUNT`, or percent
arithmetic. The only new defaults since the sweep are the two plausibility
speed bounds, already declared and documented.

## 2. Quoting service wired into checkout — done

`DeliveryQuotingUseCase` is THE service. Checkout calls it first; the legacy
zone path answers only when the result is `CONFIG_INCOMPLETE`. Every other
reason is returned as-is, because handing a correct answer to the legacy model
would replace it with a wrong one — it would happily price a lake island.

Capture writes on every quote with `priced_by`, so the fallback rate is
measurable and the deletion of the legacy paths can be evidenced.

The boundaries test caught a real violation: the use case imported
`ResolvedArea` from infrastructure. The port shape now lives in the application
layer and the adapter implements it.

## CommerceIntegrity — fixed

Asserted an exact list of exception types against a WHOLE-DATABASE scan, so it
passed on an empty test DB and failed against a restored production clone. The
assertion is now scoped to the entities the test creates. The scan is still
whole-database, which is its job.
