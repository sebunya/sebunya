# 01 — Model pricing and assumptions (verified 2026-10-12)

Source read on implementation day: https://platform.claude.com/docs/en/about-claude/pricing
(table "Model pricing"). All prices USD per million tokens.

| Model | Base input | 5 m cache write | 1 h cache write | Cache read | Output |
|---|---:|---:|---:|---:|---:|
| Claude Haiku 5.5, prompt ≤ 100,000 tokens | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 |
| Claude Haiku 5.5, prompt > 100,000 tokens | $0.50 | $0.625 | $1.00 | $0.05 | $2.50 |
| Claude Sonnet 5.5 | $2 | $2.50 | $4 | $0.10 | $10 |
| Claude Opus 5.5 | $4 | $5 | $8 | $0.20 | $20 |

These are the numbers in `MODEL_PRICES` (`apps/api/src/domain/assistant/AssistantPolicy.ts`).
An unknown model id is priced at the Opus rate, never cheaper. The long-prompt tier cannot be
reached: the engine caps the conversation at 12 turns × 2,000 characters, tool results at
6,000 characters and tool rounds at 4, so a prompt stays far below 100,000 tokens.

Chosen settings (`DEFAULT_ASSISTANT_CONFIG`, editable in `/admin/assistant`):

- model `claude-haiku-5-5`, `output_config.effort: low`, `max_tokens 1024`, no sampling parameters
  (Haiku 5.5 rejects them; pinned by `tests/unit/ShopAssistant.test.ts`), no `fallbacks` (Haiku 5.5
  documents no server-side fallback; the engine handles `stop_reason: refusal` itself).
- System prompt (2,335 characters, roughly 550–600 tokens, above the 512-token cache minimum; the tool schemas sit in the same cached prefix) carries `cache_control: ephemeral`;
  the tool list is identical on every request, so the prefix is cacheable.

Cost formula (micro-USD, rounded up per call): `input×0.1 + output×0.5 + cacheRead×0.01 + cacheWrite×0.125`.

Reservation before a paid turn = worst case with nothing cached: (toolRounds+1) × (16,000×0.1 + 1,024×0.5)
= 5 × 2,112 = 10,560 micro-USD ≈ $0.0106. Settlement replaces it with the provider-reported usage.

Planning figures (synthetic, not an invoice): 2,000 in / 200 out per call = $0.0003 per call;
the simulated normal month (812 paid calls, 70 % cache hits) settled $0.18. The stress figure
(8,000 in / 800 out) settled $0.91 for the same traffic. See `evals/simulation-output-2026-10-12.txt`.

Provider-side cap: the console's workspace spend limit is an owner task (the Default Workspace
cannot carry one per Anthropic's workspaces page); the app-side ledger is the enforcement
authority and does not depend on it. The app never claims a provider hard stop.

Accounting scope: model API spend only, UTC calendar month, excluding tax, hosting, WhatsApp.
