# 03 — Implementation and test report (2026-10-12)

Branch `feat/assistant-mandate` on `deploy/price-floor-145k` (PR #62 = `44fb4df5`), after the
two widget fixes that are PR #63 (`ffc041df`, `7d21261d`).

## Built (exact files)

API: `domain/assistant/AssistantPolicy.ts` (config, prices, cost, reservation, decision table),
`application/ports/IAssistantRepository.ts`, `application/use-cases/assistant/AssistantAdmissionUseCases.ts`,
`infrastructure/db/schema/assistant.ts`, `infrastructure/db/migrations/0175_assistant_budget_ledger.sql`
(+ `_journal.json`), `infrastructure/db/repositories/DrizzleAssistantRepository.ts`,
`infrastructure/security/AssistantCounterStore.ts`, `interfaces/http/routes/internal/assistant.ts`,
`interfaces/http/routes/admin/assistant.ts`, `app.ts` (mounts), `Registry.ts` (wiring).

Web: `lib/assistantRouter.ts` (intents + deterministic answers), `lib/assistantAdmission.ts`,
`pages/api/assistant/chat.ts` (rewritten around admission), `lib/assistant.ts` (Haiku 5.5 request
shape, usage accounting, billed/not-billed errors, model/effort/limits from admission),
`components/ShopAssistant.astro` (request id, products from events, error states),
`pages/admin/assistant.astro`, `lib/admin-navigation.ts`. Config: `.env.example`,
`docker-compose.production.yml` (ASSISTANT_MODEL removed).

Tests: `tests/unit/AssistantPolicy.test.ts`, `AssistantRouter.test.ts`, `AssistantEvals.test.ts`,
`AssistantCostSimulation.test.ts`, `ShopAssistant.test.ts` (rewritten), `Slice08B1AdminRouteProtectionSweep`
(count 183), `tests/integration/AssistantLedger.integration.test.ts`. Script:
`scripts/qa/assistant-cost-simulation.ts`. Docs: this folder, `docs/assistant/README.md`.

## Deliberately not built

- Order status, loyalty balance, delivery-fee tools: no session-scoped read exists that a chat
  could call without copying the public lookup's reference+phone fields into a prompt (Phase C).
- Clarification lineage (a follow-up not counting as a request): conservative counting instead (02c).
- Turnstile / step-up challenge: not known to be available; SOFT_LIMIT + Retry-After instead.
- Ticket creation, WhatsApp API: no system exists; link-out is labelled as such.
- SDK: blocked by the workspace's release-age guard; raw HTTP confined to one function.
- "Was this helpful?" feedback and route metrics beyond the `X-Assistant-Route`/`X-Assistant-Tier`
  headers and the ledger outcomes: next increment.

## Checks run (local, 2026-10-12)

| Check | Result |
|---|---|
| `pnpm --filter @goldplus/api exec tsc --noEmit` | clean |
| `pnpm --filter @goldplus/web typecheck` | clean |
| `pnpm --filter @goldplus/api lint`, `... web lint` | 0 errors (pre-existing warnings only) |
| Assistant unit files (Policy 11, Router 6, Evals 4, Simulation 8, ShopAssistant 13, AgentReadiness 17) | 60 passed |
| `scripts/integration-env.sh pnpm vitest run tests/integration/AssistantLedger.integration.test.ts` (real PostgreSQL, Redis absent) | 3 passed |
| Full unit + architecture suites | see the final section below |

## Cost proof (mock usage, real policy)

`evals/simulation-output-2026-10-12.txt`:

| Scenario | Paid calls | Settled | Peak committed | Cap engaged | First-four friction | Fifth served |
|---|---:|---:|---:|---|---:|---|
| Normal month, 1,000 sessions | 812 | $0.18 | $0.19 | no | 0 / 2,438 | 72 / 72 |
| Stress month (8,000/800 per call) | 812 | $0.91 | $0.92 | no | 0 | 72 / 72 |
| + four-and-reset 300 identities | 2,012 | $1.61 | $1.62 | no | 0 | 72 / 72 |
| + botnet 500 × 2 | 1,812 | $1.42 | $1.43 | no | 0 | 72 / 72 |
| + flooder 600 @ 2/s | 818 (6 attacker) | $0.19 | $0.20 | no, 580 refused | 0 | 72 / 72 |
| Stress + reset + botnet | 3,012 | $3.58 | $3.58 | no | 0 | 72 / 72 |
| Stress + 1,500 reset identities | 3,792 | $4.4897 | $4.4992 | **yes**, 3,020 free fallbacks | 0 | 53 / 72 (after the cap) |

Ledger race (PostgreSQL): 20 concurrent reservations with $0.10 headroom → exactly 9 granted.

## Speed proof

Not measured end-to-end: no API key is available locally and the production host is the owner's.
Deterministic turns do one catalogue or finder read (the same reads the pages do). First model
token depends on the provider. The widget shows the deterministic answer without a model spinner.
Measure after activation with the `X-Assistant-Route` header and the web container's timing logs.

## Customer-experience proof

Routing transcripts are the eval set run through the router (108/108 as specified). Live
transcripts with a real key are pending activation; the five mandated journeys (battery, delivery,
product, policy, order) are deterministic and their exact answers are in `AssistantRouter.test.ts`.

## Security and abuse-control proof

Covered by tests: malformed conversations refused; client cannot inject assistant/tool turns;
tool allowlist and round cap; 429-before-output not billed and released; unreachable admission
fails closed for paid, open for free; retried request id answered once; burst 21/min refused;
address 121/min refused while 100/min passes; welcome tier ignores allowances; progressive soft
limits; ledger refuses past kill under concurrency; stale reservations stay counted; internal
routes need the internal key; admin PUT needs `settings.manage`, audits, and 409s on a stale version;
non-site links render as text. Unresolved: four-and-reset is not detected, only contained (02c).

## Final suite run (after commit, clean tree, 2026-10-12 15:10 local)

- `pnpm vitest run tests/unit tests/architecture`: **658 files, 10,089 passed, 9 skipped, 0 failed**.
- `pnpm security:scan-secrets`: passed (2,886 files). `scripts/release/claude/verify-migration-parity.mjs`: PASSED (175/175).
- `astro build` (web) under Node 22.23.3: complete in 22.9 s; `pnpm -F @goldplus/api build`: complete.
- Not run locally: semgrep (not installed), Playwright e2e, `pnpm audit`; CI runs them on the `claude/assistant-mandate` copy.
