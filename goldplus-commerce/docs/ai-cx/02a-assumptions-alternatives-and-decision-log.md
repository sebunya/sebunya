# 02a — Assumption register, alternatives, decision log

## Assumption register

| Assumption in the brief | Evidence | Confidence | If wrong | Action |
|---|---|---|---|---|
| The GitHub repo `sebunya/GoldPlusFinal` is the code | Local checkout is `sebunya/sebunya`, deploy branch `deploy/price-floor-145k` | contradicted | Work on the wrong tree | Worked in the local checkout only |
| No chat exists yet | PR #62 shipped a chat on every page the same morning (Opus 5.5, raw Messages API) | contradicted | Duplicate assistant | Extended PR #62 in place |
| Homepage and FAQ disagree on the address | FAQ renders `biz.addressLine1/2` (`businessInfo.ts`); PR #43 moved the shop to Zainab Aziza | contradicted on this base | Assistant states a wrong address | Router and tools read the one source |
| VPS ≈ 3 GB / 2 vCPU | Compose limits web 512M/1 cpu, api 512M/1 cpu; host is 4 GB (memory note 2026-10-06) | verified | Chat starves checkout | No new worker; chat shares the web container's existing concurrency cap (8) |
| Redis exists for atomic windows | `RedisAbuseControlStore` with a stricter local fallback | verified | Counters per replica only | Reused; outage policy STRICT |
| Haiku 5.5 prices as listed | Pricing page read 2026-10-12 | verified | Ledger under-counts | Unknown models priced at Opus rate |
| SDK fits the stack | `pnpm add` refused by `minimumReleaseAge` | contradicted today | None functional | Raw HTTP isolated in `requestTurn()`; retry after 2026-10-15 |
| A delivery-fee engine can be called read-only | Fee exists only inside checkout use-cases | verified | Chat quotes wrong fees | Never quoted; "shown at checkout" |
| An order-status read exists for a session | `/track-order` takes reference + phone/email; no session-scoped read | verified | Enumeration via chat | No order tool; link-out only |
| A loyalty balance read exists | Loyalty APIs are account-session routes, not tools | verified | Private data in prompt | Not built (Phase C) |
| Real customer questions are available | No transcripts are stored anywhere | verified | Eval set is synthetic | Labelled synthetic in `evals/questions.json` |
| Cloudflare Turnstile / bot management is available | Not verifiable from the repo; owner toggles in Cloudflare | unknown | Step-up challenge unavailable | Designed without it: soft limit + Retry-After only |

## Alternatives compared

| | A. Rules + existing search, AI only for exceptions | B. Structured retrieval + one LLM reply for chosen intents | C. Keep PR #62 (LLM with tools on every turn) |
|---|---|---|---|
| Quality on the 108-question set | 87 answered from data verbatim; 21 go to the model with tool data | Same facts, but every turn pays for a model reply | Every turn pays; fluent, same facts |
| Speed | Deterministic turns: one catalogue/API read | One model round trip per turn (≈1–3 s first token) | Same as B |
| Cost (normal month, simulated) | $0.18 | ≈ $0.60 (every meaningful request paid) | ≈ $0.60 at Haiku; $24 at the Opus default PR #62 shipped |
| Complexity | Regex router + answers (150 lines) on top of C | Retrieval layer to build | Already built |
| Data safety | Orders/payments never reach a model | Same if intents are chosen well | Prompt is the only line for "ask on WhatsApp" |
| Failure modes | Misrouted question gets a wrong *kind* of answer (tested) | Provider outage = no answers | Same |
| VPS impact | Lowest | One more fetch per turn | Same as B |

Decision: **A on top of C**. Reasons: the eval set shows most questions are answered the same way
every time; the paid layer stays for interpretation and keeps the tools PR #62 already proved.
What would change the decision: if the router's misroute rate on real questions exceeds ~10 %
(measure via the `X-Assistant-Route` header and "not helpful" reports once added), route borderline
intents to the model with the deterministic text as a tool result.

## Decision log (question → alternatives → evidence → choice → trade-off → disproving test)

1. Enforcement authority for the $5 → provider cap / app ledger / both → provider cap cannot be set on the Default Workspace and is not visible to code → **app ledger in PostgreSQL, provider cap as an owner-side extra** → settlement lags the stream by one call → `AssistantLedger.integration` (concurrency) and the cap simulation.
2. Where to count fairness → browser / web replica / Redis → only Redis is shared by replicas and survives a roll → **Redis via `RedisAbuseControlStore`** → stricter local decision during an outage → `AssistantPolicy.test` + the STRICT outage policy.
3. Visitor principal → IP / cookie / signed-in id → the signed `gp_visit` cookie already exists and is HttpOnly; IP is CGNAT-unsafe → **id → visit token → address, hashed with a purpose prefix** → a cleared cookie is a new principal (residual risk, 02c) → simulation "four-and-reset".
4. Default model → Opus (PR #62) / Sonnet / Haiku → prices 40× apart; the facts come from tools either way → **Haiku 5.5, effort low** → weaker prose on rare hard comparisons → the eval set's 21 model questions, reviewed by hand before launch.
5. Reservation size → average / worst case → a reservation that can be exceeded is not a cap → **worst case per turn ($0.0106), settled down** → fewer concurrent paid turns near the threshold → ledger test (exactly 9 of 20 fit).
6. Fifth-request UX → CAPTCHA / login / silent allowances → the brief forbids visible friction for low-risk shoppers → **silent per-visitor paid allowances, deterministic answers continue** → a heavy genuine shopper may get the free fallback after 12 paid/hour → simulation (fifth requests served 72/72 in a normal month).
