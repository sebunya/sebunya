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

## 3. Variance write path — done

`ApplyDeliveryVarianceUseCase` + `RecordVarianceAgreementUseCase`, migration
0095, `DELIVERY_VARIANCE_APPLY` wired to its own routes.

The control that matters: above the threshold **the fee does not move**. The
variance is recorded `pending`, nothing is applied, and only the customer's
recorded agreement releases it. A decline leaves the fee alone and may cancel
without penalty — through the real order state machine, so the cancellation is
a proper transition with its own audit.

The database enforces the pairing too: an `absorbed` variance can never be
waiting on a customer, and a `needs_agreement` one can never be `not_required`.

17 tests, all synthetic — no live order exercises this.

## 4. The learning loop — done

Nightly recompute, migration 0096, five rules all holding at ZERO observations.

- **Zero is undefined.** Every fit returns `insufficient_data` with a reason and
  a count, never a small number. Proposals carry `currentState: 'not_learned'`
  and `currentValue: null` rather than a 1.0 standing in for absence.
- **No proposal below the minimum.** `calibration_min_sample_size` is Tier 1 and
  UNSET, so with no minimum there are **no proposals at all**. The queue REFUSES
  acceptance below it rather than warning — an operator should not have to
  notice a sample of two.
- **Every division guarded**, tested at n=0 and n=1 for every fitting function,
  plus zero-denominator cases and percentile indices at both ends.
- **Stateless.** Pending proposals are replaced wholesale, so two identical runs
  leave identical rows and a bad night cannot accumulate beside a good one. An
  idempotency test asserts it.
- **No synthetic data.** Pinned like 0092: every delivery migration is scanned
  for INSERT, the domain and application layers are scanned for writes to the
  capture and factor tables, and the scripts directory is scanned for anything
  named seed/demo/sample/fake/fixture.

An EDITED proposal is recorded `origin='human'`, never laundered as a fit.

Reports render emptiness in words: what exists, what is missing, what would have
to be true. The fallback-rate report is the evidence for deleting the legacy
paths, so it is first-class rather than a log line.

First-observation alert fires once ever, backed by a milestone row so "once"
survives restarts and both API replicas.

## 5. Customer surfaces — done

`DeliveryPresentation` decides tone and which registry key; `DeliveryQuote.astro`
renders it. ONE endpoint (`POST /delivery/quote`) answers the product page, the
cart and checkout, cached on a key that includes the configuration version.

**No page hardcodes a customer-facing sentence.** The API resolves the Tier 1
strings and the component renders them, so a wording edit reaches all three
surfaces without a deploy.

Tone is the control as much as the words: `CARRIER_REQUIRED` renders in the
"served differently" style, `NO_RATE_CARD` and `PARCEL_CLASS_UNKNOWN` as our own
gap confirmed later, `AREA_TOO_COARSE` as a prompt to narrow. Only
`AREA_UNSERVICEABLE` and `WATER_ACCESS` use the not-served treatment.

Cut-off countdown in EAT (tested across the UTC day boundary, where it breaks),
free-delivery progress with the exact remaining amount, pickup alongside every
outcome including refusals, pin request with no time claim, day-level promise
until an hour window is earned, parcel count before commit, and the
fee-to-value interstitial with an explicit acknowledgement that is never
pre-selected.

## 6. Control Centre completion — done

`/admin/delivery` (state, launch values, queues, version history with one-action
revert, registry-generated field list), `/admin/delivery/launch` (the wizard),
`/admin/delivery/calibration` (proposal queue, margin, variance, fallback rate).

- **Quote inspector**: `GET /admin/delivery/orders/:id/quote-explanation` returns
  origin, centroid source, mode, corridor, band, every factor with its sample
  size **and its learned/unlearned state**, config version, rounding, carrier,
  card version and every variance. An order with no capture says so as a fact
  rather than erroring.
- **CSV round trip** with a mandatory dry run reporting every changed AND every
  failing row. A CSV cannot create an area — the gazetteer is the only source,
  so a typo'd slug fails instead of quietly becoming a new row.
- **`CONFIGURATION.md` generates from the registry**, and a test asserts the
  file on disk matches the generator exactly. Drift fails the build.
- Pending variances surface at the TOP of the Control Centre, because nothing
  dispatches on them until the customer answers.
