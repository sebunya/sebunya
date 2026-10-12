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
| Engine: prompt, turn validation, Messages API call, tool loop, SSE parsing | `apps/web/src/lib/assistant.ts` |
| Endpoint `POST /api/assistant/chat` (same origin, streams `data:` frames) | `apps/web/src/pages/api/assistant/chat.ts` |
| Widget (launcher, panel, transcript in `sessionStorage`) | `apps/web/src/components/ShopAssistant.astro`, included by `BaseLayout.astro` |
| Tests | `tests/unit/ShopAssistant.test.ts` |

## Switching it on

Set `ANTHROPIC_API_KEY` in `.env.production` on the host and roll `web`
(`scripts/deploy-prod.sh <sha> web`). `docker-compose.production.yml` passes
the key to the web container. Without a key the endpoint answers 503 and the
layout renders no widget at all. `ASSISTANT_MODEL` overrides the model
(default `claude-opus-5-5`).

## Guard-rails

- The system prompt tells the model to quote prices, stock and fits only from
  tool results and to hand anything else to WhatsApp; the tools themselves strip
  internal pricing fields (`publicOnly`).
- Per visitor: 30 questions per 10 minutes; body 32 KB; 12 turns of 2,000
  characters each; at most 4 tool rounds per answer; 1,024 output tokens;
  8 concurrent answers across the site. `output_config.effort` is `low`.
- `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): a policy
  decline is re-run on Anthropic's recommended fallback model instead of ending
  the chat.
- Nothing is stored server-side. The server logs only upstream failures.
- The widget links only to this site; any other URL in an answer is plain text.

## Why raw HTTP and not the SDK

On 2026-10-12 the workspace's supply-chain guard (`minimumReleaseAge` in
`pnpm-workspace.yaml`) refused every dependency change because packages the
lockfile pins were under a week old. `requestTurn()` in `assistant.ts` is the
only place that knows the wire format; swap in `@anthropic-ai/sdk` there once
`pnpm add @anthropic-ai/sdk --filter @goldplus/web` goes through.
