# Shop assistant (site chat)

A chat panel on every storefront page ("Ask GoldPlus", bottom right). It answers
from the shop's own catalogue through the same read-only tools the public MCP
server exposes (`apps/web/src/lib/agentTools.ts`): product search, one product,
categories, the battery finder and the shop details. It cannot order, take
payment, or read a customer or an order; buying stays on the product page, and
orders and complaints are handed to WhatsApp.

## Pieces

| Piece | File |
|---|---|
| Router: deterministic intents answered from shop data, no model call | `apps/web/src/lib/assistantRouter.ts` |
| Engine: prompt, turn validation, Messages API call, tool loop, SSE parsing | `apps/web/src/lib/assistant.ts` |
| Admission client (visitor pseudonym; admit / settle / release) | `apps/web/src/lib/assistantAdmission.ts` |
| Endpoint `POST /api/assistant/chat` (same origin, streams `data:` frames) | `apps/web/src/pages/api/assistant/chat.ts` |
| Widget (launcher, panel, transcript in `sessionStorage`) | `apps/web/src/components/ShopAssistant.astro`, included by `BaseLayout.astro` |
| Policy, month ledger, counters (API) | `apps/api/src/domain/assistant/AssistantPolicy.ts`, `.../use-cases/assistant/AssistantAdmissionUseCases.ts`, migration 0175 |
| Admin page: spend this month, policy, kill switch | `/admin/assistant` (`apps/web/src/pages/admin/assistant.astro`) |
| Tests | `tests/unit/ShopAssistant.test.ts`, `AssistantRouter`, `AssistantPolicy`, `AssistantEvals`, `AssistantCostSimulation`, `tests/integration/AssistantLedger.integration.test.ts` |
| Mandate documents | `docs/ai-cx/` |

## Switching it on

Set `ANTHROPIC_API_KEY` in `.env.production` on the host and roll `web`
(`scripts/deploy-prod.sh <sha> web`). `docker-compose.production.yml` passes
the key to the web container. Without a key the endpoint answers 503 and the
layout renders no widget at all. The model (default `claude-haiku-5-5`), the
monthly cap, the fairness tiers and the abuse ceilings are set in
`/admin/assistant`, not in the environment. Migration 0175 must be applied
first (two new tables). See `docs/ai-cx/04-deployment-operations-and-rollback.md`.

## Guard-rails

- The system prompt tells the model to quote prices, stock and fits only from
  tool results and to hand anything else to WhatsApp; the tools themselves strip
  internal pricing fields (`publicOnly`).
- Deterministic first: shop, delivery, payment, orders, warranty, bulk,
  batteries and plain product lookups are answered from shop data with no
  model call. The model gets comparisons and suitability questions.
- Money: every paid turn reserves its worst case ($0.0106) in the month ledger
  before the call and settles to the provider-reported usage after; paid
  answers stop at the kill threshold ($4.50 of a $5 cap) while free answers
  continue. Alarms are logged at $2.50 / $3.50 / $4.25.
- Fairness: four meaningful requests per visitor per 24 h with nothing
  visible; from the fifth, silent paid allowances (12/hour, 24/day, 2 per
  15 s). Bursts (20/min per visitor, 120/min per address) get 429 from the
  first request. Details: `docs/ai-cx/02c-progressive-abuse-and-fair-use.md`.
- Per turn: body 32 KB; 12 turns of 2,000 characters; at most 4 tool rounds;
  1,024 output tokens; 8 concurrent paid answers per web replica;
  `output_config.effort` low; no sampling parameters (Haiku 5.5).
- A refusal (`stop_reason: refusal`) hands over to WhatsApp; Haiku 5.5 has no
  server-side fallback, so none is requested.
- Nothing customer-written is stored server-side. The ledger keeps token
  counts, cost, model, outcome and a one-way visitor pseudonym.
- The widget links only to this site; any other URL in an answer is plain text.

## Why raw HTTP and not the SDK

On 2026-10-12 the workspace's supply-chain guard (`minimumReleaseAge` in
`pnpm-workspace.yaml`) refused every dependency change because packages the
lockfile pins were under a week old. `requestTurn()` in `assistant.ts` is the
only place that knows the wire format; swap in `@anthropic-ai/sdk` there once
`pnpm add @anthropic-ai/sdk --filter @goldplus/web` goes through.
