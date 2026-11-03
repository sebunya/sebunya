# Outcomes: what we took from Web Analytics 2.0, what we left, and what the owner does in GA4

Date: 2026-11-03. Sources: Avinash Kaushik, *Web Analytics 2.0* (ch. 3, 5, 10, 11, 12) and kaushik.net posts
(best web metrics by business size; visitor segmentation; attribution: good, bad, ugly; statistical significance
and replication risk; direct traffic; the 2026 Google Analytics features piece), checked against Baymard's
checkout research, Google's GA4 documentation (default channel groups, key events, LTV, Conversion Attribution
Analysis) and the shop's own data before anything was built.

## The register: insight, self-critique, verdict

| Insight (Kaushik) | Self-critique | Verdict | Where it lives now |
|---|---|---|---|
| Small business: four KPIs only (cost per acquisition, bounce rate, checkout abandonment, macro conversion) | Bounce rate is gone in GA4 (engagement rate replaces it, and it is a weaker signal for a shop than abandonment). The other three hold. | Keep three, swap bounce for cart abandonment | `/admin/analytics/outcomes`, "The critical few" |
| Split abandonment: cart (never reached checkout) vs checkout (started, never ordered) | Still the single most useful split for a shop; Baymard's long-running checkout research reports them separately (its often-quoted ~70% is cart abandonment). We had one blended funnel. | Keep | Outcomes, "Two leaks, not one"; counts from carts, begin_checkout telemetry, orders |
| A conversion rate needs a visits denominator, not page views | True; GA4 sessions from our own copy of the daily series, same Kampala days. GA4 lags up to 2 days, so the page says how many days it covers. | Keep | Session conversion (critical four): orders on the GA4-covered days ÷ sessions on those days |
| Whales: find the ~2× AOV orders instead of averaging | Holds, trivially cheap, we never showed it. | Keep | Outcomes, "Whales" |
| Days and visits to purchase as distributions | Holds; GA4 removed the old "time lag" report from the UI for most properties, so our own touch links are the only honest source. Coverage is shown (staff-placed orders have no journey). | Keep | Outcomes, "How long, and how many visits" |
| Micro conversions with an economic value | Holds and is the one most shops skip; a count without a value never changes a decision. Values are the owner's, set once. | Keep | Outcomes, "Micro conversions, in shillings" + measurement settings `micro_value_*` |
| Segment or die: never trust an aggregate | Holds. GA4 channel and device series are what we hold; new-vs-returning share per row. | Keep | Outcomes, "Conversion by segment" |
| Direct traffic over ~30% means untagged links, not loyalty | Holds; more so for a shop that sends SMS, WhatsApp and printed QR. | Keep, with an owner-set alarm | Outcomes, "Direct traffic check" (`direct_traffic_alarm_pct`) |
| Action dashboard: critical few, each with a goal and a trend | Holds. Goals were missing everywhere. | Keep | Goals in measurement settings (`goal_*`), verdicts on the page |
| Time decay as the defensible reference model; never default to position-based; test before reallocating | Holds. Our report opened on last click; now opens on time decay with the others beside it. GA4 itself defaults to data-driven, which we cannot reproduce and do not pretend to. | Keep | Channel report default |
| Attribution proves nothing; controlled experiments and MMM do | Holds. Already built (holdouts, MMM dataset); the Outcomes page says so where it matters. | Already in place | `/admin/measurement/mmm` |
| 90% certainty floor and replication before acting | Holds. Our lift summary already refuses small arms; rates refuse under 20 (50 sessions for segments). | Keep | `rate()` minimums |
| GA "visits" metric change (2011) | Outdated: a GA Classic artefact. | Drop | — |
| Tynt, Compete, in-page click analytics, GA custom-report screenshots | Outdated tools and UIs. | Drop | — |
| Social sentiment tools (2011 list) | Outdated; Clarity session data covers the "what" better for a shop. | Drop | — |
| GA4 2026: AI assistant traffic as its own channel | New and relevant; our rulebook already classes chatgpt.com, perplexity, gemini, copilot, claude.ai, grok and co. as `ai_assistant`. GA4 groups them under "AI Assistant" by medium; AI Overviews clicks stay organic. | Already in place | `Channels.ts` |
| GA4 2026: Conversion Attribution Analysis, Cross-Channel Budgeting, Source Group, LTV percentiles | Owner-side GA4 setup, not code. | Owner steps below | — |

## What was built (PR: feat/analytics-outcomes)

- `GET /admin/analytics/outcomes` (analytics.read): critical four with goals, abandonment split, whales,
  journeys, micro conversions, segments, direct check. Bounded aggregates only.
- `/admin/analytics/outcomes` page, linked from Commerce Analytics and the admin nav.
- Measurement settings: `goal_cart_abandonment_pct`, `goal_checkout_abandonment_pct`, `goal_conversion_pct`,
  `goal_cost_per_order_ugx`, `direct_traffic_alarm_pct` (default 30), and `micro_value_<outcome>` for the seven
  micro conversions. Set them at `/admin/measurement/mmm`.
- Migration 0215: a partial index on the telemetry outbox for `begin_checkout`, so checkout starts are a cheap count.
- Channel report opens on time decay.

## GA4 steps for the owner (property G-YVV0KLGMQJ)

1. **Key events with value**: Admin → Events → mark `generate_lead`, `sign_up` and `add_to_cart` as key events
   and give `generate_lead` and `sign_up` a default value equal to the shilling value you set in measurement
   settings (so GA4's "key event value" and our economic value agree).
2. **Channel group**: Admin → Data display → Channel groups → confirm the default group shows "AI Assistant" (added
   by Google in 2026); no custom rule is needed. Check that `sms` and `whatsapp` mediums land in SMS and Social
   respectively; if they fall to Unassigned, add a custom channel group with those two rules.
3. **Source group** (Admin → Data display → Source groups): group `chatgpt.com`, `perplexity.ai`, `gemini.google.com`,
   `copilot.microsoft.com`, `claude.ai` as "AI assistants" so reports stop splitting them.
4. **Conversion Attribution Analysis** (Advertising → Attribution): keep the comparison on "Data-driven vs Last click";
   read it beside our channel report (time decay). Never move budget on either alone: use the holdouts.
5. **LTV**: Explore → User lifetime → add the "LTV: percentile" dimension; the 90th percentile is GA4's whale view.
6. **Audiences for segments**: create "Returning buyers", "Mobile, no purchase, 2+ sessions" and "Checkout started,
   no purchase (7 days)" audiences; export the last to Google Ads once paid media starts.
7. **Direct traffic**: Reports → Acquisition → Traffic acquisition, filter `(direct) / (none)`, compare with the
   Outcomes page's alarm; the two should agree within the GA4 lag.

## Known limits (read before trusting a number)

- Checkout starts come from the telemetry outbox (`begin_checkout`, one per browser). The outbox is not pruned
  today, so history is complete; if a retention job is ever added, this count shortens with it.
- "New" share per segment sums GA4's daily new and total users, so a user seen on two days counts twice.
- Journeys need `measurement.order_touch_link`; orders placed by staff or from a browser without the script have
  none, and the page shows the coverage.
- Micro "sign-ups" are all accounts created, staff included (a handful a year).
- Spend comes from `measurement.mmm_daily`, built nightly; cost per order for today is yesterday's spend.
