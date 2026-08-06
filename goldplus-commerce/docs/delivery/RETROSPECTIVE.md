# Delivery Estimation — retrospective

Written for whoever builds the next module, not for the person who commissioned
this one. It is blunt about the briefs on purpose: the briefs were unusually
good, and the places they were wrong are the only interesting part.

---

## 1. Every defect real data found in code written blind, and its class

Nine defects. **Not one was found by a unit test.** Every single one needed
either real production data or a real end-to-end run. That is the headline
finding of this build and everything else in this document follows from it.

### Class A — the code was individually correct on both sides of a seam

The most expensive class, and the hardest to test for, because nothing is wrong
until you look at two things at once.

**A1. The capture repository silently dropped nine columns.**
Migrations 0093 and 0094 added `fulfilment_mode`, `carrier`, `rate_card_id`,
`rate_card_version`, `parcel_class`, `parcel_count`, `per_parcel_fee_ugx`,
`parcel_office_id` and `priced_by`. The quoting adapter sent all nine. The
repository's `upsert` builds its values from a fixed list of known keys and
dropped every one on the floor.

Both sides were *correct*. The adapter sent the right fields; the repository
wrote the fields it knew about. The disagreement existed only between them.

Found by: a real `CheckoutUseCase` run against a restored clone, which wrote a
capture row where every new field was empty.

Cost if missed: `priced_by` would have stayed null on every order forever, and
the fallback-rate report — **the evidence for deleting the legacy paths** —
would have read 0% while the legacy path quietly served every request. The
module's finish line would have been declared on a number that measured nothing.

**A2. A stored value disagreed with the working shown to the person who
approved it.** The wizard showed "UGX 111.1 a minute" and stored `111`.
`rider_cost_per_minute_ugx` ends in `_ugx`, so the formatter guessed from the
key name — but it is a *rate*, not a price.

Found by: running the wizard end to end against a restored clone and reading
the published values back.

The amount was trivial. The class is not: a module whose whole discipline is
"no invented numbers" had a number changing between the screen and the database.

### Class B — the model was right about the world and wrong about the business

**B1. `AREA_NOT_METRO` was accurate and useless.** It told an Arua customer
where they were *not*. Three of nineteen real orders sat in it. Correct,
tested, and worthless — the customer is served, by bus, and nothing in the model
could say so.

**B2. The 56,000 UGX six-hour round trip.** Arithmetically consistent with every
input and commercially absurd. The model had no concept that a delivery fee can
exceed the value of what is being bought.

Both found by: showing real numbers for real places to a human. Neither is
findable by testing, because the code did exactly what it was designed to do.

### Class C — a test that only passed on empty data

**C1. `CommerceIntegrity.integration.test.ts`** asserted an exact list of three
exception types against a scan of the *whole database*. It passed on an empty
test database and failed the moment it ran against a restored production clone,
where real rows legitimately raise exceptions of their own.

Found by: running the 111 environment-gated integration tests against a clone
for the first time. Nobody had ever run them against real data.

A test that only passes on empty data is not testing the system, it is testing
the fixture. And a failing test erodes the green boundary that every gate in
this programme depends on, which makes it worse than no test.

### Class D — silent non-fatal skips

**D1. Skipped lifecycle mirrors.** A delivery recorded against an order not in a
dispatchable state leaves the order at `received` forever. Deliberately
non-fatal — a refusal must not void a truthfully recorded physical delivery —
but the skip was quiet, and each one is an observation the model never gets.

**D2. The capture write was `.catch(() => undefined)`.** The identical mistake,
made by me, one stage after learning it. A 19th real order arrived mid-build
with no capture row and I could not prove from the absence whether the write had
failed or had never run.

**The lesson generalises: non-fatal and silent are different decisions, and
conflating them destroys the evidence you will need later.** Every non-fatal
path in the next module should have to name where its failure surfaces.

### Class E — data that resolved correctly and unusably

**E1.** Eight of nineteen orders stored an *area* name in the *district* field.
**E2.** `GP-202608-DBF2` is recorded as "Kira, Mukono"; Kira is in Wakiso.
**E3.** Two orders store the district "Kampala" and nothing more — a correct
resolution that cannot be priced, because corridor and band exist only at area
granularity.

E3 is the interesting one: it cost 2 off the headline coverage figure (15/18
became 13/18) and the module got *more* honest in the process. The earlier
number silently picked an area inside the district.

### Class F — deployment, not code

**F1.** Host `node_modules` in the build context poisoned image installs
(`.dockerignore`). **F2.** `COPY` preserved host 600 modes, so the non-root
runtime user could not read `@goldplus/shared` (`chmod -R a+rX`). **F3.** A
missing `--env-file` took the production API down for about fifteen minutes.
**F4.** Migration 0093 was written by hand and never registered in drizzle's
journal — caught by the rehearsal on a clone, which is exactly what the
rehearsal is for.

---

## 2. Where the briefs were wrong, loose, or specified an artefact

The briefs were better than most. These are the specific failures.

### 2.1 The briefs blocked their own build on four values, four times

The single largest cost in the whole programme. The build stalled repeatedly
waiting for six numbers, and the fix — a wizard that derives them from one
delivery the shop already makes — took a few hours and should have been the
*first* thing built, not the seventh.

**For the next module: if a build can be blocked on a value, the module is
missing an input surface for that value.** Build the surface first. A brief that
says "I will send you the numbers" is describing a dependency that will not
arrive on time, because it never does.

### 2.2 A fact was scheduled as a phase-two feature

"Upcountry deliveries go by bus. Not boda." was corrected mid-build, after
stages A through C were complete. It is not a refinement — it is a fact about
physical reality, and three real orders could not be served by *any* path in the
system until it landed.

The correction was expensive because it changed the shape of what the quoting
service returns, which meant every caller changed with it.

**For the next module: separate "what is true about the world" from "what we
have decided to support". The first cannot be phased.** A roadmap can defer a
feature; it cannot defer a fact.

### 2.3 The briefs specified artefacts where they wanted outcomes

Three examples, all corrected later at cost:

- "Build the capture layer" produced a use case constructed in the Registry and
  called by nothing. Correct artefact, zero outcome.
- "The three disclaimer stages, editable with preview" produced registry entries
  read by no page. Correct artefact, zero outcome.
- "Variance with reason codes and an absorption threshold" produced a pure
  `decideVariance` that decided and never applied.

The final brief fixed this with one rule — *"no work is complete until a
customer or an operator can be observed doing the thing… list every export and
show its production caller by grep, excluding tests"* — and that rule found
`DELIVERY_VARIANCE_APPLY` sitting in the permissions vocabulary with no route
behind it.

**That rule should be in the next brief from line one.** It is the single
highest-value sentence in this entire programme.

### 2.4 A stage was reported as done when only its domain was built

Stage C was reported complete. It had built the domain of the commitment and
wired **none** of it: `quoteDelivery` had no caller outside its own tests, the
disclaimers were on no page, no capture was written at quote time, and the
variance write path did not exist.

Two sessions of context compaction later, that gap was only recovered because
the re-grounding read-back asked what each stage had left *open* rather than
what it had done. Writing down what had NOT been done was worth more than the
stage itself, and the user said so.

**For the next module: a stage report that lists only completions is not a
report.** Require the open list.

### 2.5 Loose specifications, each of which had to be resolved later

- The free-delivery threshold ordering was **undefined**, not merely
  undocumented. The field existed and was read by nothing.
- `assignment_basis` and `assignment_confidence` were conflated across two
  columns (182/180 versus 200/162).
- PART 8 said "200 rows at area level and 162 inherited" — two different columns
  described as one.
- "Weight bands for parcels" specified a data system the catalogue could not
  populate: no product has ever had a weight, so every basket would have
  resolved to `WEIGHT_UNKNOWN`. Replaced by a shipping class that is a property
  of the goods.

The pattern: **a brief that names a field is not the same as a brief that names
where the value comes from.** Ask the second question every time.

---

## 3. Every number refused, and what was done instead

This is the part I would most want the next module to copy.

| Number asked for | Refused because | What was done instead |
|---|---|---|
| The six launch values | Not mine to invent | Derived from an operator's answers about one real trip, with the working shown next to each |
| `own_rider_max_band` | Would have set where rider service ends by guessing | Wizard asks for a **place** — "the furthest you would send your own rider" — and reads the band off the gazetteer |
| An hour delivery window | Needs both an on-time target and a sample; neither existed | Day-level promise, falling out of two unset values rather than a threshold anyone chose |
| A pin time-saving claim | Zero deliveries had completed with a pin | Pin nudge ships with **no number**, and a test asserts the copy contains no digits |
| A default `corridor_factor` | Nothing had been measured | Priors, with unlearned made a different *type* from fitted |
| A minimum sample for proposals | Would have been a launch value in disguise | Ships unset; its absence means **no proposals at all** |
| A variance absorption threshold | Would decide, silently, what we absorb | `THRESHOLD_NOT_CONFIGURED` refusal rather than absorbing an unbounded amount |
| Any bus fee | Every one is a live carrier negotiation | 128 destinations imported as a skeleton; the importer **refuses to run** if a fee column is populated |
| A parcel capacity | Decides how many FEES a customer pays | Unset means a multi-item basket goes to the manual queue; a single item is one parcel, which is arithmetic |
| A district-average band | There is no such thing | `AREA_TOO_COARSE` — the customer narrows and gets a real fee |

**Two numbers were chosen, and both are flagged rather than buried:**
`plausible_speed_min_kmh: 8` and `plausible_speed_max_kmh: 45`. They are Tier 1,
editable, can never alter a fee, and only ever produce a warning. The stronger
of the two plausibility checks invents nothing at all — it restates both
readings of the operator's own answer ("read as 45 minutes there and back,
giving 18.7 km/h; had you meant each way it would be 9.3").

---

## 4. What should be structurally IMPOSSIBLE in the next module

The through-line of this build: **a rule that is merely discouraged will be
broken, usually by the person who wrote it.** Twice here, by me, one stage after
writing the rule down.

Four techniques worked, in ascending order of power.

### 4.1 Make the illegal state unconstructible (strongest)

`quoteDelivery` takes `OwnRiderArea` — `AreaInput` narrowed to
`fulfilmentMode: 'own_rider'` with a corridor and band. The bus, water and
unserviceable branches inside it are **deleted, not guarded**, because the input
type cannot carry those states.

The proof this is different from a guard: the type checker immediately found
three call sites that had been passing unnarrowed areas. A runtime guard would
have found none of them, and would have sat there returning a refusal nobody saw.

`PriorFactor` carries **no `value` field at all**, so an unlearned factor cannot
be misread as a measurement. `fittedFactor()` refuses a zero sample and hands
back a prior. That change also exposed a latent bug: fixtures were passing the
*multiplicative* neutral (prior 1) to `lastMileMinutes`, which is *additive*
(prior 0). It had only ever computed correctly because `shrinkToward`
short-circuits on a zero sample.

### 4.2 Make the agreement between two components a test

Class A defects live in seams. `DeliveryCaptureRow` versus the capture table is
now pinned by a test that asserts every column added by 0093 and 0094 appears in
the row type, is read into it, and is written from it.

**Next module: every adapter that maps a fixed list of fields onto a table needs
this test on day one.** It is ten lines and it catches the most expensive class
of defect there is.

### 4.3 Prove the wiring with the real object graph

`delivery-wizard-proof` and `delivery-checkout-proof` drive the real use cases
through the real Registry against a restored clone. Between them they found A1
and A2, and neither is findable any other way.

**Next module: a proof harness per major seam, run against a clone in CI.**

### 4.4 Make the database refuse it too

`delivery_fee_variance` has a pairing constraint: an `absorbed` variance can
never be `pending`, and a `needs_agreement` one can never be `not_required`.
`delivery_calibration_proposal` requires `sample_size > 0`. The domain refuses
these first; the database refuses them anyway.

### What was merely discouraged here, and should not be next time

1. **"Do not put a literal in the code."** Enforced by sweeps and review. Should
   be a lint rule with an explicit allowlist for structural constants.
2. **"Every registry entry needs a reader."** The brief said the build should
   flag an entry with no reader. It never did — `own_rider_max_band` and the
   parcel capacities went several commits before anything read them.
3. **"Non-fatal must not mean silent."** Learned from skipped mirrors, then
   repeated by me in the capture write. Should be a lint rule: no bare
   `.catch(() => undefined)` on a write path.
4. **"A stage is not done until it is wired."** Should be a CI check that fails
   on any exported symbol with no non-test caller, with an explicit
   `// unwired: <reason>` escape hatch.

---

## 5. The stage-completion rule, and other ledger entries

**The PART 1 rule, verbatim, because it should be copied verbatim:**

> No work is complete until a customer or an operator can be observed doing the
> thing. A test calling a function does not make it wired. A string in the
> registry does not make it shown. At every stage boundary, list every exported
> function, use case, endpoint and string the stage produced, and show its
> production caller by grep, excluding tests.

Everything else in this section is a corollary.

**Report what is unexercised, in the results and not in a footnote.** Every
report in this programme states plainly that the variance path, the learning
loop and the whole calibration layer have never run against real traffic. That
sentence is more useful than any green test count.

**Coverage is not accuracy, and saying so costs nothing.** The 39% baseline was
a *coverage* baseline. No order had ever been delivered, so there was no
accuracy to measure. Any later claim of improvement starts from zero
observations rather than from a measured error — and stating that up front
removed an entire category of future argument.

**Numbers can move because the module got more honest.** Coverage went 15/18 →
13/18 when the resolver stopped silently picking an area inside a district.
Report the direction *and* the reason, or somebody will read a regression.

**A rehearsal on a restored clone earns its cost.** It caught the unregistered
migration journal entry before it touched production, and it is where both
Class A defects surfaced.

**Retirements must be named.** `AREA_NOT_METRO`, the CORE–REMOTE band scheme,
the weight system, `goldplus_locations_seed.sql`, and the ambiguous
`{ value, sampleSize }` factor shape were each removed *and* recorded, with the
reason, in `DECISIONS.md` and in the code that replaced them. A retirement
nobody wrote down comes back.

**Write down what you did NOT do.** The Stage C finding — five things built in
the domain and wired to nothing — was worth more than Stage C, and it only
surfaced because the re-grounding asked what each stage left open.

---

# The payments section: how a shop ran with payments not working and nothing said so

This section matters more than everything above it. The delivery module was
built carefully and reported honestly, and none of that mattered, because the
thing it exists to serve — a shop that takes money — had never once taken
money, and no part of the system said so.

## What was actually true, established by reconciliation

Not what anyone believed. Pesapal's own records, queried transaction by
transaction:

- **Zero shillings ever collected.** Ten payment attempts in the system's
  life: three declined by MTN at the PIN stage (two of them charging an
  Airtel-prefix number over MTN rails — a network mismatch that fails every
  time), five abandoned on the payment page, two that never produced a payment
  page at all.
- **The callback was never broken.** Pesapal delivered three IPNs on
  2026-05-21 and the system processed all three correctly. The IPN endpoint
  answered an unauthenticated POST from the public internet on the day of the
  audit. The favourite hypothesis — webhook unreachable — was disproven in the
  first ten minutes and had been false for eleven weeks.
- **All nineteen orders were the owner and the test suite.** Seven distinct
  phone numbers, all traceable. The "customers" who could not pay did not
  exist.
- **Five payment attempts sat in `pending` from May to August**, because
  `pending` had no exit that did not depend on the provider choosing to call
  us. Nothing ever asked.

## The uncomfortable part: the system had been told, and told correctly

Three separate mechanisms knew, and each one discharged its duty into a void:

1. `StartOrderPaymentUseCase` durably recorded
   `ORDER_PAYMENT_VERIFICATION_REQUIRED` on every payment start — written,
   with a comment explaining it existed for exactly the customer-closed-the-tab
   case. **Nothing consumed it.** The safety net was designed, documented, and
   never hung up.
2. `RESERVED_LEDGER_MISMATCH` appeared in the commerce integrity report.
   **A report line nobody read is a report line that does not exist.**
3. The `payments` table held zero rows for months. **An empty table looks
   exactly like a table nobody queried.** Absence does not alert.

The pattern across all three: **recording is not surfacing.** Every mechanism
wrote a fact down; none of them made a human see it. The delivery module's
skipped-mirror lesson — non-fatal and silent are different decisions — was
learned, written into that module's retrospective, and the payment stack had
already made the same mistake at ten times the stakes.

## What monitoring should have existed, and now does

The test of each of these is not "does it detect the failure" but "who is
forced to see it, and when":

- **The business-health alert.** Not "is the API up" but "has any money
  arrived within N trading hours". Its most important behaviour is
  distinguishing "no payment for 6 hours" from **"no payment has EVER
  succeeded"** — the second was true for this shop's entire life and is the
  loudest possible signal, not a quiet day.
- **The four counters on one screen**: checkout started → payment requested →
  payment succeeded → order paid. Nineteen / ten / zero / zero was the state
  for months, and those four numbers side by side would have told the whole
  story to anyone who glanced at them. A gap between adjacent counters IS the
  outage; no log required.
- **The provider's column beside ours**, live, per attempt. Five `pending`
  rows against Pesapal's `INVALID` was a visible disagreement nobody could
  see, because nobody had put the two records on one screen.
- **The reconciliation poller** — the consumer the recorded event never had.
  Its first production sweep resolved all five trapped attempts in one pass.
  Eleven weeks of silence, cleared in the first ten minutes of something
  finally asking.
- **The synthetic probe**, proving credentials, submit, the payment page and
  IPN reachability on a schedule, honestly labelled with what it cannot prove:
  the PIN and the success callback need a real wallet.

## What test would have caught it

The one that did, eventually: `PesapalPaymentJourney.integration.test.ts`. Of
the original 111 integration tests, **not one touched the Pesapal rail** — the
only online payment path the shop has. The success branch had never executed
anywhere: not in production (no payment succeeded), not in tests (none
existed). The code that broke was precisely the code with no coverage, and it
was no accident which code that was:

**~50 of the 111 integration tests had never run anywhere, and the reason is
the deepest finding of this audit: the migration chain cannot rebuild the
database.** A fresh database built from the migration files produces an
`orders` table with 8 columns; production's has 36. Whoever last tried to
stand up a test environment hit that wall, reached for `describe.skip`, and
the suites that would have surrounded the payment path went to sleep reading
as green. The fix was to stop pretending: the test schema is now a committed
snapshot of production, the environment is one script, and a skipped
integration test fails the build with no escape hatch — the last escape hatch
was called `describe.skip`.

## What should be structurally impossible next time

1. **A state that can be entered and never left.** The payment attempt state
   machine now throws on an illegal transition and a test asserts every
   non-terminal state has an exit that does not depend on a third party's
   goodwill. This should be the template for every state machine in the
   system: the exhaustiveness test costs ten lines.
2. **A recorded fact with no consumer.** `ORDER_PAYMENT_VERIFICATION_REQUIRED`
   sat unconsumed for the system's whole life. Every durable event type should
   name its consumer or fail a wiring test — the same doctrine as "every
   export names its production caller", one level down.
3. **A timeout that decides a payment's fate.** The poller structurally cannot
   mark a payment failed: it has no code path that writes a status of its own,
   only the provider's answer. In a mobile-money market where the money leaves
   the wallet before the merchant hears anything, this is the difference
   between a late order and money taken with nothing given.
4. **A test suite that reports green minus the tests that matter.** Zero
   skipped integration tests, enforced by a gate that fails red and names the
   one command to run.
5. **A monitoring stack that measures the system and not the business.** Every
   service was healthy for months while the shop took nothing. The first
   dashboard anyone builds for a commerce system should be the four counters,
   not the CPU graph.

## The sentence to carry forward

The shop was not broken. It was **unproven** — and unproven and broken are
indistinguishable from the outside until the first real customer arrives, at
which point the difference is your reputation. Everything in this section
exists so that "no money is arriving" is a fact the system shouts on day one,
instead of a question somebody finally asks in month four.
