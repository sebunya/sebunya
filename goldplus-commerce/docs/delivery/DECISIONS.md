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
