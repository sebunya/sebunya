# GoldPlus Administrator Back Office — Phase III Estate Review

Date: 2026-09-12 · Branch `deploy/price-floor-145k` · Author: Claude (session 015rSKnhJh4vnCYwsLJqmZ6w) for the GoldPlus owner.

Vocabulary is the programme's evidence vocabulary: FOUND / REPRODUCED / FIXED / TEST VERIFIED / PUSHED / DEPLOYED / LIVE VERIFIED / OWNER ACTION / CONTENT GAP / UNRESOLVED / BOUNDED. A pushed commit is not deployed. A deployed change is not live verified.

## 0. Runtime state at close

| Item | Value | Evidence |
|---|---|---|
| Local HEAD | `10e4b655` (+ this docs commit) | `git log` |
| Origin HEAD | `10e4b655` (+ this docs commit) | `git push` output |
| Host git HEAD | `10e4b655` | `git rev-parse` on goldplus-prod |
| API runtime | `rollback-89ba2b7a` image | `docker inspect` image id = tag id |
| Web runtime | `rollback-10e4b655` image (three self-critique follow-ups on 66602ab8: 757d05a5, f1f5d475, 3bbcdae5, 10e4b655), DEPLOYED 2026-09-12 and LIVE VERIFIED: settings, verification, dealers, governance, users and customer pages answer 303 unauthenticated, storefront and shop 200, 0 web errors, 0 new API level-50 lines. Authenticated rendering of the four corrected pages was checked by serving the built SSR bundle locally with a session cookie and reading the output (200, corrected values present, 0 errors); no production admin session was available | `docker inspect` image id = tag id |
| Services | 2 api + 2 web, all healthy, 0 restarts | `docker ps` |
| Migrations | journal entries 0000–0130 (131), last `0130_order_payment_method` | `_journal.json` |
| Clean-tree suite | unit + architecture: 453 files / 7,798 tests, 0 failures. The long-running `ExperienceProfile` intermittent is FIXED at its cause: the tampered-token case built the flipped character from a second random token, so about 1.5% of runs left the token unchanged | `vitest run tests/unit tests/architecture` |
| Integration suite | not run on this workstation (Docker down, `ZeroSkipGate` fails by design when the env is absent) | `docker info` |
| New level-50 API log lines since the roll | 0 new; the 2 present are the pre-existing PAYMENT_SILENCE alarms | `docker logs --since 20m` |

## 1. How each module was inspected

Three depths, stated per row. §81 forbids scoring a module I did not operate above what I saw.

* **OPERATED** — I used the screen or endpoint against production (authenticated where the programme had a session, unauthenticated probe otherwise), or ran the module's write path through its canonical script, and read the result back from the database.
* **DB+CODE** — I read the page and route source and the production row counts behind them, but did not drive a write through the module.
* **RENDERED** — the page was served by the built SSR server with a session cookie and its output read; used for pages that have no write path.
* **CODE** — source only. The level given is a ceiling, not a claim.

Levels: 0 absent or placeholder · 1 static shell or informational · 2 functional read, or writes without guards/history · 3 operational: read + guarded writes + audit + honest empty/denied states · 4 mature: exact filters, contextual history, exception views, tests, live verified.

## 2. Final module matrix (§80) — every module, no long tail

Production counts are exact `count(*)` taken 2026-09-12 18:40 UTC.

| Module | Primary operator | Before | Depth | Features added this programme | After | Tests | Remaining gap | Verdict |
|---|---|---|---|---|---|---|---|---|
| Users & roles (`/admin/users`, 14 API handlers) | System administrator | 2 | OPERATED | Last-admin guard on revoke; account deactivate/reactivate with reason, session invalidation, self-lockout refusal; History link; the create form now labels each role with its permission count and warns when a role is empty | 3 | `AdminUserGovernanceGuards` (10), `admin-user-management` | **Nine of the twelve roles hold zero permissions in production** (Owner 130, PLATFORM_ADMINISTRATOR 121, LEGAL_REVIEWER 2, all others 0): ANALYST and SUPPORT_OPERATOR are offered at creation and would produce a user who can sign in and open nothing. Permission sets per role are an OWNER decision. MFA enrolment UI does not exist (0 of 7 enrolled) | READY, one OWNER decision |
| Governance page (`/admin/governance`) | System administrator | 1 (stale admin-creation copy; five invented roles with invented Level 5..1 ranks; a hand-written permissions matrix; a 'Role: Super administrator' badge for everyone) | RENDERED (built SSR server, session cookie) | Copy corrected; roles, active users and permission codes now read from `/admin/roles` with honest denied/unavailable states; the badge shows the session's own permission count from `/auth/admin-session` | 2 (functional read) | `AdminSurfaceIntegrity` realigned | Read-only; the Roles screen remains the place to inspect a role in full | READY |
| Customer workspace (`/admin/customers/:id`, new) | Customer-service agent | 0 | OPERATED (LIVE VERIFIED 303 unauth, API 401) | One screen: identity, orders newest-first, loyalty balance from the ledger, support by email, links to Orders/Support/History | 3 | `GetCustomerWorkspace` (4) | Read-only; no notes or tags; 7 users in prod so scale is not a concern | READY |
| Support inbox (`/admin/support`) | Customer-service agent | 2 | OPERATED | Exact filters q/status/priority/assignee/overdue, summary, honest empty state, per-row status update | 3 | route-protection sweep | `support_issues` = 0 rows: never used in production; no assignment workflow beyond a field | READY, unused |
| Quotes (`/admin/quotes`) | Store administrator | 2 | DB+CODE | none | 2 | sweep | 1 `quote_requests` row; list only, no reply/convert action | BASIC |
| Dealers (`/admin/dealers`) | Store administrator | 2 (carried two invented businesses as fallback data) | RENDERED + DB (built SSR server; approve path not driven) | Fabricated fallback removed | 2 | sweep | 0 applications; approve/reject path not exercised | BASIC |
| Orders list + detail (`/admin/orders`) | Store administrator | 3 | OPERATED | Presets limited to true exceptions (paid-not-started, payment failed, delivery failed, owner review); refunds card; Payments/History/Customer links; intent-spent divert on failed orders | 4 | `PaymentOpsSweep`, `FulfilmentTaskRefusesTerminalOrder`, checkout tests | Search is in-memory over the fetched page; DB-side search deferred (trigger below) | READY |
| Payments queue (`/admin/payments`) | Finance operator | 2 | OPERATED | Search by reference/order/email; per-attempt provider status; refund panel with collected/refunded/remaining, reason, confirm, idempotency key; sweeps select `payment_method='pesapal'` only | 3 | `PaymentOpsSweep` contract | 0 successful payments have ever landed (18 attempts); `payments_ops_config` empty so sweeps are OFF; controlled attempt BE693CD2 ended `invalid` | READY WITH KNOWN RISK, BOUNDED by the provider |
| Refunds | Finance operator | 0 (link to nowhere) | OPERATED to the confirm step, not executed | Refund request UI on top of the existing refund use case | 3 | `RefundOrderUseCase` unit tests (existing) | Never executed against a real payment (none exists); 0 `payment_refunds` | READY, UNVERIFIED LIVE by design |
| Fulfilment (`/admin/fulfilment`, 48 handlers) | Fulfilment operator | 3 (P1: tasks could advance on cancelled orders) | OPERATED (stale tasks cancelled via script, read back) | Forward moves refused when the order is terminal; stale-task cancel script | 3 | `FulfilmentTaskRefusesTerminalOrder` | 24 tasks, 0 dispatches, 0 deliveries, 0 teams: the packing→dispatch→delivery chain has never run end to end in production | READY, unexercised downstream |
| Delivery (`/admin/delivery`, `/launch`, `/calibration`, 34 handlers) | Store administrator | 3 | DB+CODE | none this phase | 3 | contract tests in `docs/delivery` suite | 6 config values, 1 version, 0 zones; five launch numbers never supplied by the owner (OWNER ACTION) | READY, values pending |
| Delivery zones (`/admin/pricing/delivery-zones`, 10 handlers) | Store administrator | 2 | CODE | none | 2 | sweep | 0 rows | BASIC |
| Products (`/admin/products`, 23 handlers) | Catalogue manager | 3 (carried an invented fallback product, never rendered) | OPERATED earlier in programme (import of 192); list RENDERED locally after the fix | History link on detail; invented fallback removed | 3 | listing/approval tests | 29 of 192 products have an image; readiness is a photo gap, not a code gap | READY, CONTENT GAP |
| Listing editor / listing quality / copy quality | Catalogue manager | 3 / 3 / 2 | DB+CODE | none | 3 / 3 / 2 | listing tests | Copy-quality export is API-only | READY |
| Inventory (`/admin/inventory`, 4 handlers) | Inventory controller | 2 | OPERATED | Per-row History link filtered to STOCK_ADJUSTED | 3 | sweep, audit filter tests | `stock_receipts`, `stock_counts` tables exist with no page and no route: receipts and counts are schema only; 1 stock location | READY for adjustments, BASIC for receipts/counts |
| Pricing (`/admin/pricing`, 8 handlers) | Finance operator | 3 | DB+CODE | none | 3 | price-floor tests | 24 adjustments, 28 quotes; no bulk price change (deliberately deferred, see §5) | READY |
| Product costs (`/admin/product-costs`, 6 handlers) | Finance operator | 2 | DB+CODE | none | 2 | sweep | 0 entries: never used | BASIC, unused |
| Media (`/admin/media`, 14 handlers) + Photos bulk | Catalogue manager | 3 | OPERATED earlier (attach-by-code) | none this phase | 3 | media tests | 26 assets / 243 variants; bulk attach is by code only | READY |
| Media costs | Finance operator | 2 | CODE | none | 2 | sweep | 0 cost facts | BASIC |
| Batteries (10 pages, 62 + 15 handlers) | Catalogue manager | 3 | DB+CODE | none | 3 | battery module tests | 80 profiles, 356 import rows, but 0 devices and 0 compatibility mappings: the finder has nothing to match (OWNER data import) | READY, DATA GAP |
| Compatibility (`/admin/compatibility`, 5 handlers) | Catalogue manager | 2 | CODE | none | 2 | sweep | 0 mappings | BASIC |
| Categories / taxonomy (`/admin/categories`, 3 handlers) | Catalogue manager | 1 | DB+CODE | none | 1 | sweep | 3 categories, no create route; Storage/Car/PC products are filed under Other. Trigger already met; deferred because the category list is a commercial and SEO decision the owner has not made | BASIC, DEFERRED |
| PIM imports (`/admin/pim-imports`) | Catalogue manager | 2 | DB+CODE | none | 2 | sweep | Ingest is a JSON textarea plus SHA; 96 rows staged; no CSV upload | BASIC |
| Loyalty (`/admin/loyalty`, `/gamification`, 43 handlers) | Marketing operator | 3 | DB+CODE (balance path exercised through the customer workspace) | Customer workspace reads the ledger | 3 | loyalty suite | 1 account, 1 ledger entry, 4 rules, 4 tiers; 0 redemptions | READY, unexercised |
| Referrals | Marketing operator | 2 | CODE | none | 2 | loyalty suite | 0 referrals; lives inside loyalty, no dedicated screen | BASIC |
| Campaigns / promotions (`/admin/campaigns`, 10 handlers) | Marketing operator | 3 | DB+CODE | none | 3 | campaign tests | 1 campaign, 2 send runs, 2 promotions, 0 coupons, 0 flash sales; email sends are BOUNDED by ZeptoMail 429 | READY, BOUNDED |
| Recommendations (6 pages) | Merchandiser | 3 | DB+CODE | none | 3 | recommendation tests | 0 rules defined; 680k events and 392 cache rows show the engine runs on defaults | READY, unconfigured |
| Merchandising (`/admin/merchandising`) | Merchandiser | 1 | CODE | none | 1 | `AdminSurfaceIntegrity` | Static description of where each homepage section is controlled | informational by design |
| Carts (`/admin/carts`, 1 handler) | Marketing operator | 3 | DB+CODE | none | 3 | sweep | 33 carts, 30 abandonments; no outreach action (email is dead, and no abandonment window has been set by the owner) | READY, no action path |
| Hero / homepage / nav / business info / storefront copy / footer | Content operator | 3 | OPERATED (LIVE VERIFIED on the storefront) | WhatsApp block and footer made admin-managed; hero rail final copy applied | 4 | six footer tests realigned, P0 content contracts | none material | READY |
| Blog (`/admin/blog`, 8 handlers) | Content operator | 3 | DB+CODE | none | 3 | blog tests | 1 post | READY |
| Legal (`/admin/legal`, 10 handlers, 14 forms) | Content operator | 3 | DB+CODE | none | 3 | legal tests | 12 policies, 1 version: versioning has been used once | READY |
| SEO — 26 pages, 6 route files, 117 handlers | Growth operator | 3 | DB+CODE | none | 3 | seo suites | Populated: link graph 11,542, crawl pages 183, guardian runs 112, intel runs 111, competitors 59, queries 14, GSC 85. Empty: web vitals, SERP observations, robots versions, render diffs, storage tests, opportunities. Those six pages are functional reads of empty tables | READY where data exists, BASIC where none |
| SEO integrations | Growth operator | 3 | DB+CODE | none | 3 | seo suites | 1 connection, 27 sync jobs; GTM/analytics BOUNDED by owner config | READY |
| Feeds (`/admin/feeds`) | Growth operator | 3 | DB+CODE | none this phase (opt-out listing shipped in 0128) | 3 | feed tests | Feed generated live; `product_feeds` tables unused | READY |
| UTM builder | Growth operator | 3 | DB+CODE | none | 3 | sweep | 2 links | READY |
| Surveys (`/admin/surveys`, 6 handlers) | Growth operator | 2 | CODE | none | 2 | sweep | 0 definitions, 0 responses | BASIC, unused |
| Search demand (`/admin/demand`, 4 handlers) | Growth operator | 3 | DB+CODE | none this phase (human-traffic gate shipped earlier) | 3 | demand tests | 58 clean signals, 231 insights | READY |
| Customer DNA / lifecycle | Growth operator | 2 | CODE | none | 2 | sweep | 0 profiles, 0 lifecycle snapshots | BASIC |
| Behavioural interventions (4 handlers) | Growth operator | 2 | CODE | none | 2 | sweep | 0 definitions | BASIC |
| Experiments (6 handlers) | Growth operator | 2 | CODE | none | 2 | sweep | 0 experiments | BASIC |
| Decision intelligence (11 handlers) | Growth operator | 2 | DB+CODE | none | 2 | sweep | 6 recommendations, 0 policies | BASIC |
| Analytics (`/admin/analytics`, 19 handlers) | Growth operator | 3 | DB+CODE | none | 3 | `AnalyticsKampalaTime` | none material | READY |
| Reports | Store administrator | 2 | CODE | none | 2 | sweep | single fetch, no export | BASIC |
| Measurement — control tower, attribution, consent audit, DLQ, GTM, paid social (9 pages, 35 handlers) | Measurement operator | 2 | DB+CODE | none | 2 | measurement suites | 0 destinations, 0 GTM containers, 0 DLQ events; sGTM unprovisioned (OWNER) | BASIC, BOUNDED |
| Measurement handover | Measurement operator | 1 | CODE | none | 1 | — | Static handbook shell, no data | informational |
| Notifications (`/admin/notifications`, `/order-emails`, 13 handlers) | Store administrator | 3 | DB+CODE | none | 3 | notification tests | 342 attempts: SMS delivers, every email is a provider 429 (OWNER: ZeptoMail); 0 template overrides | READY, BOUNDED |
| Automation (14 handlers) | Store administrator | 2 | CODE | none | 2 | sweep | 0 definitions, 0 executions | BASIC, unused |
| Queues / outbox (`/admin/system`, 5 handlers) | System administrator | 3 | OPERATED (backlog diagnosed) | none | 3 | sweep | 112 outbox events, backlog is external (ZeptoMail, sGTM telemetry) | READY |
| Fraud (`/admin/fraud`, 7 handlers) | Finance operator | 2 | CODE | none | 2 | sweep | 0 signals, 0 cases | BASIC, unused |
| Consent operating / consent operations / measurement consent (16 handlers) | Measurement operator | 2 | DB+CODE | none | 2 | consent tests | 30 consent events, 8 states, 0 purposes configured | BASIC |
| Control centre approvals (`/admin/control-centre-approvals`, 8 handlers) | System administrator | 3 | DB+CODE | none | 3 | sweep | 5 module activation approvals recorded | READY |
| Platform modules | System administrator | 3 | DB+CODE | none | 3 | sweep | pairs with the approvals above | READY |
| Controlled activation ×3 (governance, dry-run, live canary; 18 handlers) | Measurement operator | 0 | CODE | none | 0 | sweep | Three shells render a title and nothing else; 0 rows in every table; API exists without a client. Trigger: first measurement destination activation | PLACEHOLDER |
| Release readiness (19 handlers) | System administrator | 1 | CODE | none | 1 | sweep | Shell renders only the heading; 0 runs, 0 decisions | PLACEHOLDER |
| Deployment (API only, 5 handlers) | System administrator | 2 | CODE | none | 2 | sweep | Maintenance flag and deploy info exist as an API; no page reads them | BASIC |
| Operational health (`/admin/system`, `/health`) | System administrator | 3 | OPERATED | none | 3 | — | Synthetic catalogue monitor is blind (Cloudflare 403 to Node fetch, pre-existing) | READY, one blind monitor |
| Audit (`/admin/audit`) | System administrator | 2 (approximate in-memory filters) | OPERATED | DB-side actor/action/entity filters, before/after state, history links from Orders, Users, Products, Inventory, Customer | 4 | audit filter tests | 874 rows; entity history is exact | READY |
| Settings (`/admin/settings`) | System administrator | 1 (stated four values that were wrong or invented) | RENDERED (built SSR server, session cookie; no write path exists) | Wrong values corrected, invented rows removed, cart retention bound to the shared constant | 1 (informational by design) | build | Reads nothing at runtime; maintenance flag not shown | informational |
| Verification / holograms (`/admin/verification`) | Store administrator | 0 (showed "Verified / Active" and "0 / Safe" from static text) | RENDERED (built SSR server, session cookie; no write path exists) | Invented status replaced by Not wired | 0, honest | build | No admin read over `verification_attempts` (3) or `fake_product_reports` | PLACEHOLDER, honest |
| Commerce OS | Store administrator | 1 | CODE | none | 1 | sweep | 0 records | PLACEHOLDER |
| Locations (`/admin/locations`, 15 handlers) | Store administrator | 3 | DB+CODE | none | 3 | location suite | 5,805 areas, 255 data exceptions to review | READY |

Route protection: all 139 admin pages redirect unauthenticated (303) and all 62 admin API route modules require a permission; the counts are pinned by `Slice08B1AdminRouteProtectionSweep`.

## 3. Feature inventory — what this programme added to the Back Office

Ordered by value (§82), each with before / problem / capability / benefit / risk reduced / reuse / tests / live line.

1. **Terminal-order guard on fulfilment** — Before: a packing task could advance on a cancelled order. Problem: stock and labour spent on dead orders (P1). Added: forward transitions refuse when the order is cancelled/failed/completed, fail-closed; stale tasks closed by script. Benefit: operators cannot ship a cancelled order. Reuse: `TransitionFulfilmentTaskUseCase` with an optional order reader. Tests: `FulfilmentTaskRefusesTerminalOrder`. Live: DEPLOYED, stale tasks cancelled and read back (LIVE VERIFIED).
2. **Payment-ops sweeps select PesaPal orders only** — Before: sweeps could auto-cancel cash-on-delivery orders. Added: `orders.payment_method` (migration 0130, backfilled), sweeps filter on it. Tests: `PaymentOpsSweep` contract. Live: migrated via `migrate-prod.sh` with rehearsal; DEPLOYED.
3. **Refund request from the Back Office** — Before: a Refund link that led nowhere. Added: panel with collected/refunded/remaining, reason, confirmation, idempotency key. Live: DEPLOYED; deliberately not executed (no real payment exists).
4. **Audit as a reusable history capability** — Before: 200-row in-memory filters implied exactness. Added: DB-side filters, before/after, entity history links from five modules. Live: DEPLOYED, LIVE VERIFIED.
5. **Access governance** — last-admin guard, deactivation with session invalidation, self-lockout refusal, maker/checker grants. Live: DEPLOYED.
6. **Customer workspace** — one screen per customer. Live: DEPLOYED at 89ba2b7a, LIVE VERIFIED (303 / 401).
7. **Support filters and honest empty states**. Live: DEPLOYED.
8. **Order exception presets limited to true exceptions** — after my own presets had manufactured urgency. Live: DEPLOYED.
9. **Checkout intent divert on un-collectable orders** — a failed order no longer wedges the customer. Live: DEPLOYED.
10. **Admin-managed WhatsApp block and footer; hero final copy**. Live: LIVE VERIFIED on the storefront.
11. **Deactivation is proven to bite immediately** — checked, not assumed: the admin auth path (`liveSession`) rejects a token whose user is inactive or whose issue time precedes the revocation cutoff on every request, so a deactivated administrator loses access at once rather than at the 7-day token expiry.
12. **Truthful Settings, Verification, Dealers, Governance and Products pages** — four pages stated invented or stale facts (session 24 h vs 7 days, cookie Strict vs Lax, a recommendation engine version, a gateway timeout, "Verified / Safe" hologram status, an aggregation API "being designed", two invented dealer businesses, an invented fallback product, five invented roles with ranks, a hardcoded 'Super administrator' badge, "admins cannot be created here"). Corrected across 34daedc2, 757d05a5, f1f5d475 and 3bbcdae5; all four pages rendered through the built server and read back. Live: see §9.

## 3a. Permission reconciliation (third pass)

Shared code defines 104 permission codes; the database holds 130 rows over 126 distinct codes. Every code the routes check exists in the database and is held by Owner, so **no admin route is dead for everyone**. The 22 database-only codes are a legacy `read.products` / `manage.promotions` convention that no route checks; four of them exist twice. The platform administrator lacks exactly five of those legacy codes and nothing the routes use, so the earlier "121 versus 130" difference is not an access gap. Role holders today: two Owner accounts (one also PLATFORM_ADMINISTRATOR) and one LEGAL_REVIEWER (`legal.read`, `legal.approve`). The last-admin guard counts PLATFORM_ADMINISTRATOR holders only; with the platform administrator also an Owner, no sequence of deactivations can remove the last account able to manage access. Cleaning the 22 legacy rows is a production data change and is deferred to an owner-approved cleanup.

## 4. Deferred items with triggers (§83 context)

| Item | Why deferred | Trigger to build | Risk if built now |
|---|---|---|---|
| DB-side order search | 37 orders; in-memory search over the fetched page is exact at this volume | orders > 200 or the first operator complaint of a missing hit | none functional, small |
| Category creation | Taxonomy is a commercial and SEO decision; storefront nav, feeds and canonical clusters key on category slugs | owner supplies the category list | wrong slugs break SEO clusters |
| Bulk price / stock operations | 192 SKUs are still one-by-one workable; bulk writes to price or stock without preview/confirm/audit are the highest-regression change in the estate | a second price-list import, or > 50 SKUs needing one change | commercial semantics changed en masse |
| Stock receipts and counts UI | tables exist, no page, no route, 0 rows; one stock location | the first supplier delivery recorded outside adjustments | new write path without a workflow owner |
| MFA enrolment UI | `requireStepUp` exists; 0 enrolled; only one active platform administrator | a second administrator, or the credential rotation the owner still owes | lockout of the only admin |
| Legacy permission rows (22 codes, 4 duplicated) | harmless: no route checks them; deleting rows from an access table is a production data change | owner-approved cleanup window | none functional |
| Permission sets for the nine empty roles | Which screens a support operator, analyst, fulfilment manager or merchandiser may touch is a business decision; guessing would grant access nobody approved | the owner names the first person to hold one of these roles | over- or under-granting a real person |
| Roles editor | 12 roles / 92 permissions are seeded; no operator has needed a custom role | first custom-role request | permission drift |
| Controlled activation / release readiness clients | shells with 0 rows; the API exists | first measurement destination goes live | speculative UI |
| Deployment page (maintenance flag) | API only; owner deploys by script | first request to toggle maintenance from a browser | none |
| Cart abandonment outreach | email never delivers; no abandonment window set by the owner | ZeptoMail funded and an owner-approved window | spam and invented windows |
| Verification admin read | 3 attempts, 0 reports; no consumer of the numbers | first counterfeit report | none |

## 5. Owner actions (unchanged list, all still open)

1. Caddy D-1 patch (`trusted_proxies` + `client_ip_headers CF-Connecting-IP`) so per-IP limits converge.
2. Confirm the outcome of controlled payment GP-202609-BE693CD2 (recorded `invalid`).
3. Set `payments_ops_config` windows (sweeps are OFF until set).
4. Fund or replace ZeptoMail (every email has returned 429).
5. Supply the five delivery launch values.
6. Rotate the admin credential that reached git history; enrol MFA once a second admin exists.
7. Import battery devices and compatibility (finder has nothing to match).
8. Product photos (29 of 192).
9. Category list decision.
10. GTM/sGTM configuration and `PUBLIC_GTM_ID`.
11. Secrets disaster recovery: `.env.production` exists on the host only.
12. Restrict origin ports 80/443 to Cloudflare.
13. Decide the permission sets for the nine empty roles before creating any user with them.

## 6. Remaining Level 0–2 modules (§83), each with the reason

Level 0: Controlled activation ×3, Verification, Commerce OS — no data, no client, or no read path; building UI on empty tables would be speculative.
Level 1: Governance, Merchandising, Settings, Measurement handover, Release readiness, Categories — informational or shell; Categories is the one with a met trigger and an owner decision pending.
Level 2: Quotes, Dealers, Delivery zones, Product costs, Media costs, Compatibility, PIM imports, Referrals, Surveys, Customer DNA, Behavioural interventions, Experiments, Decision intelligence, Reports, Measurement (all screens), Automation, Fraud, Consent, Deployment — every one is a functional read over a table with 0–8 rows. They did not reach 3 because nobody has operated them; adding guards and history to unused modules would be untested surface.

## 7. World-class gap (§84)

Context: strong for orders, payments, customers, audit; weak for growth modules (no cross-links from experiments or campaigns to outcomes). Speed: fine at this volume; the first scale wall is the in-memory order search. Exception management: exact for orders, payments, fulfilment, delivery; absent for inventory (no low-stock view) and media (no missing-image queue, though listing quality covers it). Search: order/email/reference/SKU covered; no global search. Workflow depth: fulfilment chain never run end to end; refunds never executed. Safe bulk operations: none, by decision. Recovery: rollback tags per deploy, migration rehearsal, backups; no tested restore drill this phase. Observability: health, queues, audit; one blind synthetic monitor. Decision support: analytics exist; decision intelligence has 0 policies. Access governance: now guarded; MFA unenrolled. Scalability: untested past a few dozen orders. Automation: 0 definitions.

## 8. Self-critique (§85)

1. **Thought mature, actually basic:** Settings. It looked like a configuration console; it is static text, and four of its values were wrong or invented until today. Governance was worse than I first scored it: I corrected its admin-creation copy and moved on, and only on the second pass questioned the five roles and the permissions matrix beneath it, which were invented outright. The lesson is recorded: a page that states access facts must read them from the authority.
2. **Misleading feature I built:** the first order presets ("Awaiting payment", "Paid in preparation") manufactured urgency for normal states. Removed at 7a2c3d6b.
3. **Approximate path:** audit filters over 200 in-memory rows. Now DB-side.
4. **Link to nowhere:** the Refund link. Now a real panel.
5. **Widened exposure:** the audit list now returns previousState/newState; the customer workspace returns phone and email. Both sit behind ORDERS_READ or AUTH_MANAGE and expose nothing that the order and user screens did not already show. No secrets, tokens or OTPs are ever written to audit state.
6. **Weakest module:** Verification (honest zero) and the three controlled-activation shells.
7. **Best operator experience:** Orders detail, then the Customer workspace.
8. **Unnecessary hopping:** Payments → Order still needs a search; Product → Media is a separate screen.
9. **Power-user frustration:** no bulk price or stock edit; no global search.
10. **New-operator confusion:** the number of growth and measurement screens with empty tables, and three activation shells that do nothing.
11. **First to hit scale:** Orders in-memory search, then the payments queue's per-attempt provider calls (50 parallel, 3 s timeout, verified acceptable today).
12. **Biggest regression surface:** the fulfilment terminal-order guard and the payment-method sweep filter, because they sit inside money and stock paths. Both are fail-closed and contract-tested.
13. **Deferred as too risky:** bulk price/stock operations and category creation.
14. **Rejected as bloat:** a notes/tags system on the customer workspace, a roles editor, a deployment page, and UI for the activation shells.
15. **Surface-inspected only:** yes, and named per row. Every module was read at source and against production counts, but 45 of the 62 matrix rows were not operated with a write (17 were). The blocker is not external: they hold no data to operate on, and writing synthetic rows into production to "operate" them is outside the safety boundary.
16. **Unresolved process:** none. The earlier background shell was the deploy whose SSH dropped after the roll; the roll itself completed (image tags and healthy containers confirm it).
17. **Runtime SHA:** API image id equals the `rollback-89ba2b7a` tag id; web is confirmed in §9.
18. **What prevents world-class:** no payment has ever succeeded, the email channel is dead, and half the growth estate has never been used. Those are owner and provider facts, not code facts, and the report would be dishonest to score around them.

## 9. Verdicts (§86)

**TECHNICAL READINESS: READY WITH KNOWN RISKS.** Every admin surface is permission-gated, the money and stock paths are guarded and contract-tested, the suite is green on a clean tree, and each roll has a rollback tag. The known risks are external: an unproven payment provider path, a dead email provider, and the unpatched Caddy client-IP defect.

**OPERATIONAL MATURITY: DEVELOPING.** The core operating loop (orders, payments, fulfilment, customers, audit, content) is at Level 3–4. The rest of the estate is functional but unused: 28 of 62 modules are at Level 0–2, almost all on tables with fewer than ten rows. Strong technical readiness does not lift this; a Back Office is mature when its operators run it, and most of this one has not been run.

**REVIEW COVERAGE: SUBSTANTIAL.** Every one of the 62 admin route modules and 139 pages was individually inspected at source and against exact production counts, and none is hidden behind a summary row. It is not COMPLETE because 45 of the 62 modules were not operated with a write, for the reason given in answer 15.

