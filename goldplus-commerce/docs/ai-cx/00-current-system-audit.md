# 00 — Current system audit (read-only, before coding)

Mandate: `GOLDPLUS_CLAUDE_CODE_AI_CUSTOMER_EXPERIENCE_V3.md` §2. Audited 2026-10-12 in the
real checkout `~/goldplus-live/goldplus-commerce` (git worktree of `sebunya/sebunya`,
remote `git@github.com:sebunya/sebunya.git`), branch `feat/assistant-mandate`, base
`deploy/price-floor-145k` at `44fb4df5` (PR #62 merged). The GitHub repository the
brief named (`sebunya/GoldPlusFinal`) is not this project; nothing was taken from it.

## What already existed on the base commit

| Capability | Actual file / module / route | Data authority | Reuse | Risk / gap |
|---|---|---|---|---|
| Site chat (PR #62) | `apps/web/src/lib/assistant.ts` (engine), `apps/web/src/pages/api/assistant/chat.ts` (SSE endpoint), `apps/web/src/components/ShopAssistant.astro` (widget) | Tool results only | Extended, not replaced | Had no cost ledger, no fairness tiers, no deterministic routing; default model was Opus 5.5 ($4/$20) |
| Shop tools (shared with `/mcp`) | `apps/web/src/lib/agentTools.ts`: `search_products`, `get_product`, `list_categories`, `find_battery`, `store_info`; `publicOnly()` strips internal pricing fields | Public catalogue API (`apps/web/src/lib/catalogue.ts`), battery finder API, `businessInfo.ts` | Reused unchanged | Read-only by construction; no order, loyalty or fee tool exists |
| Product search | `search_products` → the storefront's approved catalogue read (`fetchApprovedCatalogueWithStatus`), live price and availability per card | Commerce API (pricing in `EvaluateCartPricingUseCase` at checkout) | Reused | Card prices are display prices; checkout remains the authority (the widget says so) |
| Battery finder | `find_battery` → `apps/api/src/application/use-cases/batteries/BatteryFinderUseCases.ts`; fits carry `fitState` (`VERIFIED` / `AWAITING_VERIFICATION`) and `fitLabel` | Reviewed compatibility records (0169–0174, PRs #57–#61) | Reused | Supplier-listed fits are labelled "not yet checked by us"; the router repeats the label |
| Live price & stock | Same catalogue read as the product cards on the site | Commerce API | Read-only | Short-lived; the card says "today's prices" |
| Delivery & fees | `store_info` → `businessInfo.ts` (delivery note, hours, cut-off); fee is computed only at checkout (`CheckoutUseCase`) | Business info + checkout | Read-only text; fee never quoted | No fee API exists for a chat; the router says the fee is shown at checkout |
| Order tracking | `apps/web/src/pages/track-order.astro` (reference + checkout phone/email) | Commerce API with its own verification | Link-out only | Deliberately no order tool: the model never sees an order, so there is nothing to enumerate |
| FAQ & policies | `apps/web/src/pages/faq.astro` renders address, hours and delivery from `businessInfo.ts`; `/warranty`, `/returns`, `/verification` pages | `businessInfo.ts` + `storefrontCopy.ts` | Canonical source reused | The Wilson Road / Burton Street contradiction the brief saw is gone on this base: the FAQ reads `biz.addressLine1/2` (Zainab Aziza Building, Burton Street, PR #43) |
| Customer support | WhatsApp link (`biz.whatsappUrl`), `/support`, `/support/fake` | Business info | Link-out, labelled as opening WhatsApp | No ticket system exists; none was invented |
| Analytics / consent | `apps/web/src/lib/measurement.ts`, GTM after load+idle (PR #49) | Consent state in the site | Not touched | The chat emits no marketing events and sends nothing to GTM |
| Visitor identity | `apps/web/src/middleware.ts`: signed first-party `gp_visit` cookie (`VISIT_COOKIE_NAME`), `locals.gpUserId` for signed-in customers; `visitorKey()` in `publicFormLimiter.ts` for the trusted address | Middleware | Reused as the principal | The cookie is a cheap identity, not proof of a different human (see 02c) |
| Distributed counters | `apps/api/src/infrastructure/security/RedisAbuseControlStore.ts` (Redis sliding windows, labelled stricter local fallback, `outagePolicy: 'STRICT'`) | Redis | Reused via `AssistantCounterStore` | Redis outage degrades to a stricter local decision, never to "allow everything" |
| Internal web→API trust | `X-GoldPlus-Internal-Key` (`isInternalCaller`, constant-time) used for floor-price redaction | `INTERNAL_API_KEY` in both containers | Reused for `/internal/assistant/*` | Same key already protects a more sensitive surface |
| Admin auth & permissions | `authMiddleware`, `requirePermissions`, `PERMISSIONS.ANALYTICS_READ` / `SETTINGS_MANAGE`, `createAuditLogUseCase` | Existing roles | Reused | Route-protection sweep test counts every admin page (bumped to 183) |
| Resources | `docker-compose.production.yml`: web and api each `cpus: 1.0`, `memory: 512M` (reservations 0.25 / 256M); Caddy in front | Compose | Unchanged | Caddy flushes `text/event-stream` responses immediately; the endpoint also sends `X-Accel-Buffering: no` |

## Baseline checks on the base commit

- `pnpm vitest run tests/unit tests/architecture`: 10,062 passed, 9 skipped, 0 failed on the clean tree (PR #62 CI run 38236071444 green).
- `pnpm --filter @goldplus/api exec tsc --noEmit`, `pnpm --filter @goldplus/web typecheck`: clean.
- `astro check` is not installed in this workspace (`@astrojs/check` absent); `tsc --noEmit` is the web type gate CI uses.

## Trace of one customer request (browser → backend → database)

1. Widget posts `{messages}` with `X-Assistant-Request-Id` to `/api/assistant/chat` (same origin, 32 KB cap).
2. The endpoint validates turns, classifies the last message (`assistantRouter.classify`), derives the principal pseudonym (signed-in id → `gp_visit` token → address), and calls `POST /internal/assistant/admit` on the API.
3. The API counts the request in Redis windows, reads the month ledger (`assistant_model_calls`), applies `decideAdmission`, and for a paid turn inserts a `RESERVED` row under a per-month advisory lock.
4. Deterministic route: the answer is built from `store_info`, `find_battery` or `search_products` and streamed. Paid route: `runAssistant` streams Claude with the five tools, then `/settle` (provider usage) or `/release` (not billed).
5. The browser renders text and product cards from the `products` events; prices on the cards come from the catalogue, never from the prose.

## Contradictions and ungrounded promises found

- Shop address: resolved on this base (one source, `businessInfo.ts`). The category hub copy describes the block "between Wilson Road and Burton Street", which is a description, not a second address.
- FAQ "we replace it or refund you": the router's POLICY answer says cover depends on the product and the team checks the item first, and links the warranty and returns pages. No policy wording was changed.
- Delivery fee and ETA: never quoted; the fee is computed at checkout and the router says so.
