# 02c — Progressive abuse control and fair use (mandate §5A)

## What "four times" means here

Four **meaningful requests** per principal per rolling 24 hours (`freeRequests: 4`,
`fairnessWindowHours: 24`). A meaningful request is one `POST /api/assistant/chat` that passes
validation and is not refused by a burst ceiling, whether it is answered from data or by the
model. Opening the widget, typing, clearing the transcript, reloading or opening another tab
sends nothing and counts nothing. A retried send with the same `X-Assistant-Request-Id` is
refused with 409 inside two minutes on the same replica and so counts once. The browser keeps
its transcript in `sessionStorage`; the counters live in Redis under the principal pseudonym,
so clearing the chat does not reset them.

Clarification lineage: when the finder has just asked "Which of these is your phone?" and the
customer's next turn is a short reply that routes deterministically, the reply is read as part of
the open request and does not spend a welcome request (`isClarificationReply`, `continuation`).
The flag is honoured only on deterministic turns, which cost no model money, so a client that
forges it on a paid turn gains nothing: paid turns are always counted. Other follow-ups (a new
intent, anything that goes to the model) count as new requests.

Retries: the browser sends one `X-Assistant-Request-Id` per send. The web replica refuses a
repeat for two minutes, and the API's shared Redis counter (`assistant.request`) refuses a second
arrival on any replica (`DUPLICATE`, 409), before anything is counted or reserved.

## The five concerns, five signals

| Concern | Signal | Window | Default | Answer when exceeded |
|---|---|---|---|---|
| Infrastructure / automation | requests per principal | 1 min | 20 | 429 + `Retry-After: 60`, before any work |
| Infrastructure / shared network | requests per network address | 1 min | 120 | 429 (high on purpose: 50 shoppers × 2/min behind one NAT pass) |
| Fairness tier | meaningful requests per principal | 24 h | 4 free | tier flips from welcome to progressive; nothing visible |
| Model resource (progressive only) | paid generations per principal | 1 h / 24 h / 15 s | 12 / 24 / 2 | SOFT_LIMIT: free catalogue answer + the honest sentence |
| Money | settled + reserved + this turn | UTC month | kill $4.50 of cap $5.00 | GLOBAL_BUDGET_FALLBACK: same free answer |

All numbers are configuration (`assistant_config`, editable in `/admin/assistant`, audited).
The four-request threshold is owner policy; the rest are tuning candidates.

## Decision table (`decideAdmission`, in order)

| # | Condition | Decision | Visible to customer | Visible to operator |
|---|---|---|---|---|
| 1 | assistant switched off | DISABLED | widget not rendered / 503 | admin switch |
| 2 | principal burst > 20/min | DENY_EXPENSIVE | 429 "Please wait a moment" | status counts |
| 3 | address burst > 120/min | DENY_EXPENSIVE | 429 | status counts |
| 4 | question is deterministic | ALLOW_DETERMINISTIC | normal answer | `X-Assistant-Route: deterministic` |
| 5 | paid layer off | AI_DISABLED | free answer + honest sentence | admin switch |
| 6 | progressive and paid/day > 24 | SOFT_LIMIT | free answer + honest sentence | reason in logs |
| 7 | progressive and paid/hour > 12 | SOFT_LIMIT | same | |
| 8 | progressive and paid in 15 s > 2 | SOFT_LIMIT (+ `retryAfterSeconds`) | same | |
| 9 | month committed + reservation > kill | GLOBAL_BUDGET_FALLBACK | same | ledger status, alarm logs |
| 10 | otherwise | ALLOW_AI (reservation inserted atomically) | streamed answer | `X-Assistant-Route: ai` |

`OPTIONAL_CHALLENGE` from the brief's state list is not implemented: no site-native challenge
(Turnstile) is known to be available, and the brief says not to add paid anti-bot tooling. The
step-up today is the SOFT_LIMIT answer plus `Retry-After`.

## Identity

`principalHash` = sha256 of `assistant:user:<id>` (signed-in) else `assistant:visit:<gp_visit token>`
(signed, HttpOnly, first-party, issued by the middleware) else `assistant:address:<trusted address>`.
`addressHash` = sha256 of `assistant:net:<address>` truncated to 32 hex. The API sees hashes only;
nothing is logged with a raw cookie, id or address. The ledger stores `principal_hash`, not text.

## Attack paths, outcome in the simulation (`scripts/qa/assistant-cost-simulation.ts`)

| Path | What happens | Residual risk |
|---|---|---|
| Four-and-reset (300 fresh cookies × 4 paid, paced 18 s apart) | 1,200 paid answers bought, $1.43 on a normal month; address ceiling never trips at 13/min | **Not detected by counters.** Containment is the month ledger: with 1,500 identities the cap engaged at $4.4897 settled, peak committed $4.4992 ≤ $4.50, and the remaining 3,020 turns got free answers |
| Botnet (500 bots × 2 behind 50 addresses) | 1,000 paid answers, no address block (20/min per address) | Same: ledger is the containment |
| Single flooder (600 at 2/s) | 580 refused with 429, 6 paid | — |
| Parallel race for the last cents | 20 concurrent reservations, exactly 9 fit (integration test on PostgreSQL, advisory lock per month) | — |
| Amplification | body 32 KB, 12 turns × 2,000 chars, tool result 6,000 chars, 4 rounds, 1,024 output tokens, 60 s upstream timeout | — |
| Session sharing | no server transcript; turns are what the browser sends and are validated; no order data anywhere | — |
| CGNAT false positive | 50 shoppers × 2 paid behind one address: 100 paid, 0 refused | — |
| Free-path abuse | deterministic answers still cost a catalogue read; the burst ceiling (20/min) applies to them too | DB load from 20 searches/min per principal is the accepted bound |
| Hostile feedback | the model never sees limits, the ledger or the config; the ledger ignores the model | — |

## Simulated false positives

Normal month: 2,438 welcome-tier genuine requests, friction 0; 72 fifth requests, 72 served.
Heavy-but-genuine (2 % of sessions, 10–12 requests, 6 paid) met no soft limit in the normal month.
A genuine shopper arriving after the cap engages gets the free answer; the honest sentence tells them so.

## Trade-off when the owner raises quotas

Raising `paidPerHour`/`paidPerDay` increases what one patient attacker buys per identity; raising
`freeRequests` increases what four-and-reset buys per cookie. The month ledger still holds the
total, so the trade is between genuine heavy shoppers' comfort and how early in the month the
cap can be reached by abuse.
