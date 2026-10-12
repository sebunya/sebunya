# 02 — Architecture and guardrails

## The shape (what runs per customer turn)

```
browser widget ──POST /api/assistant/chat (web container, same origin)──┐
   validateTurns → classify (deterministic first) → principal pseudonym   │
                                                                         ▼
                            POST /internal/assistant/admit (api container)
                              Redis windows: burst / address / meaningful / paid
                              month ledger: settled + reserved + this turn ≤ kill?
                              ──► decision + reservation id (paid turns only)
   ALLOW_DETERMINISTIC ─► answer from shop data (store_info / find_battery / search_products)
   ALLOW_AI ───────────► Claude Haiku 5.5 with the 5 read-only tools, streamed
                          └─► /settle (provider usage) or /release (certainly not billed)
   SOFT_LIMIT / GLOBAL_BUDGET_FALLBACK / AI_DISABLED ─► free catalogue lookup + honest sentence
   DENY_EXPENSIVE ─────► 429 + Retry-After, before any work
```

Files: `apps/web/src/lib/assistantRouter.ts` (intents and deterministic answers),
`apps/web/src/lib/assistantAdmission.ts` (web side of admit/settle/release),
`apps/web/src/pages/api/assistant/chat.ts` (the endpoint), `apps/web/src/lib/assistant.ts`
(model engine), `apps/api/src/domain/assistant/AssistantPolicy.ts` (pure policy),
`apps/api/src/application/use-cases/assistant/AssistantAdmissionUseCases.ts`,
`apps/api/src/infrastructure/db/repositories/DrizzleAssistantRepository.ts` (ledger, config),
`apps/api/src/interfaces/http/routes/internal/assistant.ts`, `.../routes/admin/assistant.ts`,
`apps/web/src/pages/admin/assistant.astro`, migration `0175_assistant_budget_ledger.sql`.

## Routing rules as implemented

Deterministic (no model, no reservation): greetings; orders (link to `/track-order`); payments
(PesaPal and pay-on-confirmation copy from `storefrontCopy`); bulk (links to `/bulk`, `/quote-request`);
warranty / returns / genuine (policy pages); batteries (the finder, with ambiguity → one question);
delivery (business info, fee at checkout); store (address, hours, map, WhatsApp); plain product
lookups ("how much", "do you have", nouns). Model: comparisons, suitability, "which/best/compatible/
fast-charge/laptop", anything unclassified. The eval set (108 questions) is 81 % deterministic (87 of 108).

## Source-of-truth priorities honoured

Price/stock: catalogue read per request, cards say today's prices, checkout is final. Fits: reviewed
records with their state label. Policy: the pages. Fee/ETA: never stated. Orders/loyalty: no tool.
Conflict or nothing found: the router says so and links WhatsApp; the model is told the same.

## Guardrails that are code, not prompt

| Guardrail | Where | Test |
|---|---|---|
| No paid call without a reservation id | `chat.ts` (`route === 'ai'` requires `admission.reservationId`) | ShopAssistant.test "interpretive question goes to the model against a reservation" |
| Ledger refuses past the kill threshold, atomically | `DrizzleAssistantLedgerRepository.reserve` (advisory lock per month) | AssistantLedger.integration (20 concurrent, exactly 9 fit) |
| Unknown usage is never zero | stale RESERVED → UNKNOWN, still counted; release only on `billed: false` | AssistantLedger.integration; ShopAssistant.test "429 before output releases" |
| Burst / address ceilings before any work | `decideAdmission` order | AssistantPolicy.test |
| Welcome tier 1–4 has no allowance checks | `decideAdmission` (`tier === 'progressive'` guard) | AssistantPolicy.test "requests one to four" |
| Tool allowlist, bounded rounds, bounded tool output | `assistant.ts` (`isToolName`, `maxToolRounds`, `MAX_TOOL_RESULT_CHARS`) | ShopAssistant.test "tool loop ... stops" |
| No sampling params, no prefill, thinking replayed unchanged | `requestTurn`, `readTurn` | ShopAssistant.test |
| Client cannot smuggle assistant/tool turns | `validateTurns` (roles alternate, strings only) | ShopAssistant.test "refuses a malformed conversation" |
| Idempotent retries | `X-Assistant-Request-Id` seen-recently map (per replica, 2 min) | ShopAssistant.test "retried send ... answered once" |
| Links only to this site; no HTML from the model | widget `render()` and `cards()` | widget code; eval #88, #89 |
| Internal pricing never leaves | `publicOnly()` in agentTools | AgentReadiness.test (17) |
| Admin changes audited and version-checked | `PUT /admin/assistant/config` (409 on stale version, `ASSISTANT_CONFIG_UPDATED`) | AuditLowFindings convention |
| Fail closed for money, open for free help | `AssistantAdmissionUseCases.config()` (unreadable config → `aiEnabled:false`); `chat.ts` admission-unreachable default | ShopAssistant.test "unreachable admission API fails closed" |

## Permission matrix

| Surface | Who | Check |
|---|---|---|
| `POST /api/assistant/chat` | anyone on the site | same-origin, body cap, validateTurns, admission |
| `POST /internal/assistant/{admit,settle,release}` | web container only | `X-GoldPlus-Internal-Key` |
| `GET /admin/assistant/{status,config}` | `analytics.read` | session + permission |
| `PUT /admin/assistant/config` | `settings.manage` | session + permission + audit |
| `/admin/assistant` page | admin session | `readSessionToken` (route sweep test) |

## Provider abstraction

Only `requestTurn()` knows the wire format. The SDK could not be installed on 2026-10-12
(`minimumReleaseAge` in `pnpm-workspace.yaml` refuses the re-resolve while pinned packages are
under seven days old); retry `pnpm add @anthropic-ai/sdk --filter @goldplus/web` after ~2026-10-15.
