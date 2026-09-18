# AI Search Visibility (AEO / GEO)

Where ChatGPT, Claude, Gemini and Perplexity **name** the brand (mentions) and
**cite** its site (citations), where competitors win, what changed, and which
evidence-backed action to take next — with approvals and before/after
verification. Admin: `/admin/ai-search`. API: `/admin/ai-visibility`.
Migration: `0131_ai_visibility.sql`.

Design informed by the open-source Canonry project (MIT). No Canonry code,
branding or assets are used; the patterns borrowed are listed under
"Provenance" below.

## The two measures are never merged

| | Meaning | Denominator |
|---|---|---|
| **Mentioned** | the answer text names the brand (or an alias) | answered observations |
| **Cited** | the answer's source list includes a page on one of the project's domains | observations whose provider **returned source data** |

An answer whose provider exposes no sources has `own_cited = NULL` — unknown,
excluded from the citation rate, never counted as "not cited". A rate with no
evidence is `null` ("no data"), never 0%. There is no blended visibility score.

## Architecture (hexagonal, same rules as the rest of the API)

```
domain/ai-visibility/        pure rules — no Hono, no Drizzle
  Domains.ts        host normalisation, subdomain matching, page keys
  Mentions.ts       word-boundary, spacing-tolerant brand matching
  Citations.ts      OWN / COMPETITOR / THIRD_PARTY + source kind
  Evidence.ts       one answer -> mentions + classified citations
  Metrics.ts        mention/citation rates and shares (separate)
  Gaps.ts           gap rules, each naming its rule and observation ids
  Recommendations.ts  gap -> proposal with why/mechanism/verification/limits
  Budget.ts         pre-run and per-call spend decisions
  RunLifecycle.ts   run states, partial failure, retry policy
  Actions.ts        action lifecycle, risk classes, approval rules
application/ports/AiVisibility.ts          provider + repository ports
application/use-cases/ai-visibility/       Setup, Run, Insights, Action use cases
infrastructure/ai-visibility/providers/    OpenAI, Anthropic, Gemini, Perplexity
infrastructure/ai-visibility/AiVisibilityWiring.ts   composition (Registry.aiVisibility)
infrastructure/db/repositories/DrizzleAiVisibilityRepository.ts
interfaces/http/routes/admin/ai-visibility.ts        thin routes
apps/web/src/pages/admin/ai-search/*                 thin views over the API
```

The web UI, scripts and agents all call the same API, which calls the same
use cases. There is no logic in the pages that an agent cannot reach.

## Data model (0131)

`aiv_projects` (brand, aliases, domains, market, spend limits) ·
`aiv_project_competitors` (pins onto the shared `seo_competitors` registry — no
duplicate competitor model) · `aiv_provider_configs` (model, web search, cost
estimate, monthly cap, **encrypted** key + mask, last health check) ·
`aiv_queries` (text, intent, stage, branded, topic, property, market,
source/provenance, priority, tags, active) · `aiv_runs` (kind MONITOR /
RESEARCH / VERIFICATION, status, idempotency key, progress, estimated and
actual spend, actor kind, approver) · `aiv_observations` (one answer: provider,
model, full text, citation support, mentioned, cited, location requested vs
applied, tokens, cost, raw metadata; unique per run × question × provider) ·
`aiv_citations` · `aiv_mentions` · `aiv_actions` · `aiv_action_events`.

Observations, citations and mentions are **insert-only**. A later run adds
rows; it never rewrites history. Deleting a tracked question keeps its answers
(`query_id` is `ON DELETE SET NULL` and the question text is copied onto each
observation).

## Providers

| Provider | Endpoint | Search | Citations are read from | Location |
|---|---|---|---|---|
| OpenAI | `POST /v1/responses` | `web_search` tool, `tool_choice: required` | `output[].content[].annotations[type=url_citation]` | `user_location` (applied) |
| Anthropic | `POST /v1/messages` | `web_search_20250305`, forced via `tool_choice` | `content[type=text].citations[type=web_search_result_location]` only | `user_location` (applied) |
| Gemini | `…/models/{m}:generateContent` | `google_search` grounding | `groundingChunks` referenced by `groundingSupports`; redirect URLs resolved to the titled site | not applied |
| Perplexity | `POST /chat/completions` (Sonar) | always on | `search_results[]`, else `citations[]` | not applied |

The question is sent **exactly as written** — no system prompt, no brand
injection, no location pasted into the question. Where a provider has no
location parameter, `applied_location` is NULL and the UI says so. Engine
self-links (chatgpt.com, perplexity.ai, vertexaisearch redirects…) are never
counted as sources. Raw metadata (served model, search queries, response id)
is kept so evidence can be re-parsed.

Adding a provider = one adapter implementing `AiAnswerProvider` + one line in
`providers/index.ts` + the CHECK constraint on `aiv_provider_configs.provider`.

## Run lifecycle

`AWAITING_APPROVAL → QUEUED → RUNNING → COMPLETED | PARTIAL | FAILED`, plus
`CANCELLED` and `REJECTED`.

1. **Plan** (API request): active questions × enabled providers; refuse if no
   provider is configured ("Not configured"), if a run of the same kind is
   already active, or if the idempotency key (kind + providers + questions +
   hour) already exists (the existing run is returned).
2. **Budget**: estimated cost = calls × per-call estimate; refused if it
   breaks the per-run, daily, monthly or per-provider cap (audited as
   `AIV_RUN_REFUSED_BUDGET`).
3. **Approval**: above `approval_above_usd`, **or requested by any machine
   actor**, the run waits for a person (never the requester).
4. **Execute** (BullMQ `analytics-fanout`, job `aiv-run`, jobId = run id):
   providers in parallel, questions sequential per provider; before each call
   the spend is re-checked; transient errors retry with exponential backoff
   (3 attempts); a failed call is stored as a FAILED observation with its
   error; one provider failing makes the run PARTIAL, not FAILED.
5. **Recovery**: runs stuck RUNNING > 2 h are marked FAILED at worker start.

Cost per answer: the provider's reported cost where it gives one
(`PROVIDER_REPORTED`), otherwise the configured per-call estimate
(`ESTIMATE_PER_CALL`, labelled "estimate" in the UI). Spend limits are
computed from these recorded costs.

## Research vs monitoring

RESEARCH runs ask ad-hoc questions once. They are stored (and browsable in
Answers) but are excluded from every KPI, never add tracked questions, never
pin competitors and never touch schedules. "Track this question" is an
explicit button.

## Actions, approval and verification

`DRAFT → AWAITING_APPROVAL → APPROVED → COMPLETED → VERIFICATION_PENDING →
VERIFIED | NOT_VERIFIED` (plus REJECTED, CANCELLED, FAILED). Every move is a
compare-and-set with an `aiv_action_events` row and an audit row.

| Risk | Categories | Rule |
|---|---|---|
| MEASURE | measurement run, report | spends budget → run budget/approval rules |
| CONFIGURE | query / competitor tracking | manage permission |
| EDIT | content, metadata, schema, links, code | approval by a person other than the proposer |
| PUBLISH | indexing submission | approval **and** carried out by a person, never an agent |
| DESTRUCTIVE | (none automated) | person only |

Machine actors propose and prepare; only a person approves; nobody approves
their own proposal. The baseline (citation state of the action's questions) is
frozen at approval. Verification compares only answers recorded **after** the
change, after the measurement window (default 14 days), and its wording states
that a before/after comparison shows coincidence, not cause.

## Permissions

| Permission | Allows |
|---|---|
| `ai_visibility.view` | read everything |
| `ai_visibility.manage` | project, questions, competitor pins, provider settings, actions (propose/submit/execute/verify) |
| `ai_visibility.run` | start/cancel runs and research (spends money) |
| `ai_visibility.approve` | approve/reject runs and actions |
| `ai_visibility.credentials` | set/remove/test provider API keys |

Granted by `PermissionRegistrySync` at boot: admin all; marketing
view/manage/run; analyst and read-only roles view.

## Agents (Claude Code and others)

Use the API with a session token and send `X-Actor-Kind: AGENT`. The header
can only **lower** privileges: an agent's runs always wait for a person, it can
never approve, and it can never carry out a PUBLISH action. Useful calls:

```
GET  /admin/ai-visibility/projects/goldplus/summary        what changed, next action
GET  /admin/ai-visibility/projects/goldplus/gaps           gaps + recommendations (with observation ids)
GET  /admin/ai-visibility/projects/goldplus/answers/:id    full evidence for one answer
GET  /admin/ai-visibility/projects/goldplus/queries/:id/compare
POST /admin/ai-visibility/projects/goldplus/actions        propose (title, reason, evidence, mechanism…)
POST /admin/ai-visibility/projects/goldplus/runs           request a run (waits for approval if agent)
```

There is no MCP server in this repository yet. One would be a thin client over
these endpoints (not new business logic).

## Security

- Keys: AES-256-GCM via `IntegrationCredentialVault` (`SEO_CREDENTIAL_VAULT_KEY`,
  falling back to `JWT_SECRET`); never returned, never logged, never audited —
  only a mask. Without a vault key, keys cannot be stored ("Not configured").
- Provider calls go only to four fixed hosts (no caller-supplied URLs → no SSRF
  surface); 90 s timeout per call.
- Every route requires auth + a specific permission; every mutation is audited
  in its use case. Project isolation: every query is scoped by `project_id`.
- Cited URLs are rendered as `rel="noopener noreferrer nofollow"` links.

## Operations

- Environment: no new variables. Keys are entered in Settings.
- Deploy: migration via `scripts/migrate-prod.sh`, then `scripts/deploy-prod.sh <sha> api web`.
- Tests: `tests/unit/AiVisibilityDomain.test.ts`, `AiVisibilityProviders.test.ts`,
  `AiVisibilityVerticalSlice.test.ts` (whole loop against an in-memory repository).

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Not configured: no AI provider is enabled" | add a key, test it, switch the provider on |
| Run stays "Waiting for approval" | over the approval threshold or requested by an agent; approve under Runs |
| Run PARTIAL | at least one call failed; open the run's answers — each failure shows the provider's error |
| Citation rate "no data" | no answer with source data yet (provider returned none, or no run) |
| HTTP 402 BUDGET | the run would break a spend limit; the message says which |

## Not built yet (next phases)

Schedules for recurring runs, alerts and signed webhooks, the web/JSON report,
GA4 and AI-referral classification, a site graph, CMS/indexing execution, an
MCP server and CLI. Search Console performance is already on `/admin/seo`;
crawler activity on `/admin/seo/crawler-logs`; technical crawl on
`/admin/seo/technical`.

## Provenance

Patterns taken from Canonry (MIT), reimplemented: mentions and citations as
independent signals; forcing search where the API allows; counting only
text-cited sources for Anthropic; Gemini supported-chunk filtering and
redirect resolution; dropping engine self-domains; keeping the query text on
each snapshot so history survives deletion; partial-run semantics.
