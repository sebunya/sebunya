# Goldie, the GoldPlus personal shopper (site chat)

> **Identity rule (owner, 2026-10-13).** Goldie's title is "personal shopper", shown with a lifelike
> portrait (`apps/web/public/goldie/`) and no "AI" tag or word on screen. Because she looks like a
> person, she must never pass as one when asked (owner, same day: no "not a person" line on screen):
> the router answers "are you a real person / a bot / who are you" itself with a fixed
> honest reply (intent `IDENTITY`, no model call); and the system prompt forbids claiming to be human.
> `tests/unit/GoldieIsHonestAboutBeingVirtual.test.ts` pins both. Do not remove them.

## Personal shopper layer (owner, 2026-10-13)

- **Voice.** The prompt follows the GoldPlus voice (brand book §15, messaging deck, `docs/customer-language-standard.md`):
  plain Kampala English, "Let's check" and "Thanks for letting us know", numbers said flatly ("20W means 20W"),
  recommend one product rather than list, no chatbot openers. Router replies (`assistantRouter.ts`) use the same voice.
- **Knows the shopper.** `/api/assistant/hello` (panel welcome) and every paid turn read
  `POST /internal/assistant/context`: first name (saved address, else last order), visits (the hero's measure: 2+
  returning, 4+ regular), has ordered, top categories, last viewed products, past Goldie topics. The model gets it as
  a second system block after the cache breakpoint (`shopperNote()`), labelled as data. The welcome is built in
  `lib/goldieGreeting.ts` ("Good evening Sarah, welcome back. Last time you were looking at power banks...").
- **Customer DNA.** Product, battery and bulk questions are filed as zero-party signals (`declared_intent`,
  `source_component = 'goldie_chat'`, payload `{source, intent, topic, phone_model?}`) through
  `CaptureZeroPartyDataUseCase`, so personalisation consent is respected. Never orders, payments, complaints, phone
  numbers or emails (`interestTopic()`). The transcript itself is still not stored.
- **Human pace.** A short reading pause (650-1600 ms by question length), then a word-by-word reveal at ~70
  characters a second, capped at 2.6 s; cards and chips follow the sentence. Reduced motion: 350 ms pause, no reveal.
  Numbers in `lib/goldieGreeting.ts`.
- **Keep or pass on the chat** (row under the conversation once Goldie has answered):
  - *Email me a copy*: `POST /api/assistant/transcript` -> outbox `GOLDIE_TRANSCRIPT` (transactional) to the
    typed address. Links are stripped from the shopper's lines; 3 per address per day (API) and 3 per visitor per
    10 minutes (middleware budget).
  - *Save* (labelled "Save", "Save or share" to screen readers): the phone's share sheet (save to notes, send to self on WhatsApp), else a .txt download.
  - *Email the team* (also a chip on order, warranty, bulk, identity and unknown answers): `POST /api/assistant/handover`
    -> support ticket (`type inquiry`, `metadata.source = 'goldie'`, in /admin/support) + outbox `GOLDIE_HANDOVER`
    (operational) to `ADMIN_ORDER_NOTIFICATION_EMAILS`; with a customer email, Reply-To is the customer, and they get
    a copy.
- Tests: `tests/unit/GoldiePersonalShopper.test.ts`.

## Customer care, conversations and channels (owner, 2026-10-13)

**Listen first** (`lib/goldieEmpathy.ts`, no model): every message gets a mood read (upset, worried, confused,
happy, calm). Every fixed answer opens with a line that names the customer's situation in that mood (O2's
"acknowledge, own, resolve, check" was the owner's reference), and closes with a check-back when it helps. A thin
request ("charger", "I need help") gets one clarifying question instead of a guess. An upset customer about an
order, payment, delivery or a fault always gets "Email the team". The model gets the same rules in the prompt
("Listen first") plus a per-turn note of the mood.

**One brain, every channel** (`lib/goldieTurn.ts`): classify + mood, Customer DNA, admission and spend, then a fixed
answer or the model with tools. The website (`/api/assistant/chat`) and WhatsApp (`/api/internal/goldie/turn`) both
call it.

**Customer care from the commerce engine** (`lib/goldieCare.ts`, not in agentTools/MCP):
- *Order tracking*: reference + phone or email, through the same verified `POST /commerce/orders/lookup` as Track my
  order (5-tries lockout per reference, one answer for a wrong reference or a wrong contact; now on the
  `order-lookup` rate family). Signed in: the customer's own latest orders (`/account/orders`, their token).
- *Points*: signed in only, `/account/loyalty`, which now also returns `tier` (current, next, points to go; the
  nightly rule, `tierStanding()`) and `soonestExpiry`. A guest is asked to sign in, never looked up by phone.
- *Delivery quotes*: the one quoting service (`POST /delivery/quote`) when a place is named.
- On WhatsApp the sender's number is verified by Meta, so it is the proof for THEIR orders (placed with that
  number) and points (when it is an account's verified phone): `POST /internal/assistant/care-by-phone`.
- Goldie cannot place, change or cancel an order, take or confirm a payment, refund, or approve warranty. Those go to
  the team.

**Conversation archive** (migration 0177, `assistant_conversations` + `assistant_messages`):
- Every website turn is filed under the browser's conversation id (`X-Goldie-Conversation`). Every WhatsApp message
  is filed by the API before Goldie answers, so nothing is lost. Stored per message: topic (intent), mood and route.
  Rolled up per conversation: first and last topic, lowest mood, outcome (open / resolved / handed over / needs a
  person), contact, support ticket.
- Card numbers, PINs, OTPs and passwords are redacted before storage (`ConversationArchive.redact`).
- Kept 365 days; the nightly job purges older threads.
- The panel footer says chats are kept, with a link to /privacy. **Owner: add a line to the privacy policy.**
- Admin: `/admin/assistant/conversations` shows the meeting summary (conversations, what customers came for, moods,
  outcomes, share handled by Goldie, follow-up list), filters, CSV, and each thread. On a thread the team can take
  over (Goldie stays quiet on WhatsApp), reply (sent on WhatsApp), and set the outcome. Reading needs
  `customer_data.view` and is audited per thread; actions need `orders.manage` and are audited.

**WhatsApp switch-on** (off until all of this is done):
1. The shop number must be on the WhatsApp Cloud API (or coexistence), with the webhook from Ads > Offline already
   subscribed to `messages` (same `/webhooks/whatsapp`, same app secret).
2. A system-user token with `whatsapp_business_messaging`: set `GOLDIE_WHATSAPP_TOKEN` on the api container, or
   save it as the access token in the WhatsApp ads settings.
3. `GOLDIE_WHATSAPP_PHONE_NUMBER_ID=<the number's Cloud API id>` and `GOLDIE_WHATSAPP_ENABLED=true` on the api
   container. To trial it first, set `GOLDIE_WHATSAPP_TEST_NUMBERS=2567...,2567...` and only those numbers get Goldie.
4. The api reaches the web container at `WEB_INTERNAL_ORIGIN` (default `http://web:4321`); both share `INTERNAL_API_KEY`.
5. Free-form replies only work within 24 hours of the customer's last message (WhatsApp's rule). Team replies after
   that are refused with that reason.
- Tests: `tests/unit/GoldieCustomerCare.test.ts`.

Goldie is the shop's host on every storefront page: a named, warm, plain-spoken
voice (system prompt `goldie-2026-10-13.3` in `assistant.ts`; deterministic
answers in `assistantRouter.ts`). She greets by time of day, answers in one to
three sentences, and offers the next step as an action chip (`links` events)
beside product cards (`products` events); the model is told not to paste URLs or
markdown because the cards and chips carry them. It answers from the shop's own
catalogue through the same read-only tools the public MCP server exposes
(`apps/web/src/lib/agentTools.ts`): product search, one product, categories,
the battery finder and the shop details. It cannot order, take payment, or read
a customer or an order; orders and complaints are handed to WhatsApp. A product
card with a catalogue id, a price and stock offers **Add to cart** (the product
page's own POST to `/cart`, read for its result), so a shopper can ask, see and
add without leaving the conversation.

### How she gets noticed (2026-10-13, researched)

Built on Baymard's live-chat usability testing (floating chat on phones is the
most harmful pattern; invitations on filter and checkout pages disrupt; chat the
shopper starts is fast and welcome; invite once, after reading), published
proactive-chat trigger benchmarks (30 to 45 s or 60% scroll, page-specific),
Amazon Rufus (questions on the product page itself) and WCAG 2.2.1.

- **Entry on the product page**: two inline "Ask Goldie" questions under the
  key facts (`AskGoldie.astro`), user-initiated. Where they exist the launcher
  stays quiet: one voice per page.
- **Launcher**: out of the first paint, rises after load + idle. On phones it
  folds to the avatar while scrolling down and lifts above the product page's
  buy bar.
- **Desktop teaser**: one message written for the page (product, batteries,
  chargers, power banks, cables, audio, storage, delivery, guides, home) after
  30 s of reading or 60% scroll, once per visitor per week
  (`localStorage` `gp-assistant-teased-at`), with two question chips. X or
  Escape dismisses; ignored, it folds to an unread dot after a minute and the
  panel opens with the same message and chips, so nothing is lost to the timer.
- **Phones**: no bubble. The pill carries a short line for 12 s, then returns
  to size with an unread dot; the panel carries the full message.
- **Never** on checkout, cart, account, orders, auth, the finders, search, the
  filtered shop list, compare, quote, bulk or dealer pages.
- **Goldie never asks what the site knows**: the phone chosen in the battery
  finder (cookie `gp_battery_device`, readable) names every question; the
  delivery question respects the shop cutoff in Kampala time ("Can it come
  today?" only while today is possible).
- **Panel**: at most four starter chips; the keyboard is not raised on phones
  until the shopper taps the box; "Prefer a person? WhatsApp us" is a real tap
  target. The panel's code (`apps/web/src/scripts/goldie-panel.ts`) loads on
  the first sign of interest (hover, focus, touch, tap, or an inline
  question); while it loads the pill says "Opening…", and if it never arrives
  the shopper is offered WhatsApp instead of a dead button.
- **Measured** through the nav telemetry as NBA items: `goldie-<context>`
  impressions, taps and dismissals (`-pill` on phones, `-chip` for a teaser
  chip, `goldie-inline-pdp` for the product page questions,
  `goldie-cart-add` for a cart add, `goldie-launcher` as PANEL_OPEN). Keys must be lowercase slugs of at most 32 characters or the server drops them (`goldieKey()`). They show
  in the admin nav report's NBA table; judge the teaser by its tap rate against
  its dismiss rate after a week.
- Every motion respects prefers-reduced-motion.

## Pieces

| Piece | File |
|---|---|
| Router: deterministic intents answered from shop data, no model call | `apps/web/src/lib/assistantRouter.ts` |
| Engine: prompt, turn validation, Messages API call, tool loop, SSE parsing | `apps/web/src/lib/assistant.ts` |
| Admission client (visitor pseudonym; admit / settle / release) | `apps/web/src/lib/assistantAdmission.ts` |
| Endpoint `POST /api/assistant/chat` (same origin, streams `data:` frames) | `apps/web/src/pages/api/assistant/chat.ts` |
| Widget: launcher and awareness layer (teaser, pill, lift, telemetry) | `apps/web/src/components/ShopAssistant.astro`, included by `BaseLayout.astro` |
| Panel: conversation, cards, Add to cart, transcript in `sessionStorage` (lazy) | `apps/web/src/scripts/goldie-panel.ts` |
| Inline product-page questions | `apps/web/src/components/AskGoldie.astro`, placed in `products/[slug].astro` |
| Policy, month ledger, counters (API) | `apps/api/src/domain/assistant/AssistantPolicy.ts`, `.../use-cases/assistant/AssistantAdmissionUseCases.ts`, migration 0175 |
| Admin page: spend this month, policy, kill switch | `/admin/assistant` (`apps/web/src/pages/admin/assistant.astro`) |
| Tests | `tests/unit/ShopAssistant.test.ts`, `AssistantRouter`, `AssistantPolicy`, `AssistantEvals`, `AssistantCostSimulation`, `tests/integration/AssistantLedger.integration.test.ts` |
| Mandate documents | `docs/ai-cx/` |

## Switching it on

Set `ANTHROPIC_API_KEY` in `.env.production` on the host (and `ANTHROPIC_WORKSPACE_ID` if the key is organisation-scoped: the API otherwise answers "not scoped to a workspace") and roll `web`
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
- Add to cart from a card is offered only when the card carries a valid
  catalogue id, a price and stock; the POST is the product page's own and the
  server's redirect (`/cart?added=<id>`) is the only success signal. A refused
  line links to the cart page, which explains why.

## Why raw HTTP and not the SDK

On 2026-10-12 the workspace's supply-chain guard (`minimumReleaseAge` in
`pnpm-workspace.yaml`) refused every dependency change because packages the
lockfile pins were under a week old. `requestTurn()` in `assistant.ts` is the
only place that knows the wire format; swap in `@anthropic-ai/sdk` there once
`pnpm add @anthropic-ai/sdk --filter @goldplus/web` goes through.
