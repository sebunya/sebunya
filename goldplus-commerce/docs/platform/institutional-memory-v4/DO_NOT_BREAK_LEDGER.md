# Do-not-break ledger
SHA `707876d` · 2026-08-03. Each row = a proven behaviour with its guard. Breaking any row is a release blocker.

| # | Invariant | Proof/guard today | Planned guard hardening |
|---|---|---|---|
| 1 | Web SSR never issues relative fetches; `apiBase` non-empty in both runtimes | RC-1 fix + live sweep (0/65 broken) | architecture test forbidding `?? '` fallback on PUBLIC_API_BASE_URL + route-contract banners |
| 2 | `GET /cart` mints `__Host-gp_cart` (HttpOnly/Secure/Lax) when secrets present | live curl proof | route-contract asserts Set-Cookie |
| 3 | Web-minted cart credential verifies on API (shared keyring, dedicated secrets in both services) | live E2E | compose review checklist + readiness |
| 4 | First ADD creates server cart idempotently; REMOVE/UPDATE/CLEAR on missing cart stay CART_NOT_FOUND | live E2E (subtotal 50000) | NEW unit tests (this programme, slice S3) |
| 5 | Cart prices come from catalogue (`product_prices` → fallback `products.price_ugx`), never the request body | MutateCartUseCase code | unit test |
| 6 | Cart page renders real prices (no `UShNaN`); local-cookie parse emits `unitPriceUgx`+`slug` | live proof | NEW unit test on `parseLocalCartCookie` |
| 7 | Checkout prices client items server-side; payment webhook idempotency (replay returns ok, no double-paid) | ExecuteCheckoutIntentUseCase + synthetic replay stage design | keep; do not gate off idempotency test in candidate envs |
| 8 | SyntheticMonitor mutating stages OFF in prod (`SYNTHETIC_MONITOR_WRITE_STAGES_ENABLED` default false) | RC-5 + live log (writeStagesSkipped:true) | env default in compose; never flip without synthetic-safe env |
| 9 | API startup does not depend on pgbouncer; pgbouncer pinned by digest, LISTEN_PORT=6432 | RC-4 + healthy stack | compose is canonical; do not re-add dependency |
| 10 | PROXY_TOPOLOGY_MODE required (CADDY_EDGE in prod) | readiness subsystem | keep |
| 11 | Owner/PLATFORM_ADMINISTRATOR retains full permission set; admin (Robert) can access every internal module | live sweep 33/34 pages 200 | replace ad-hoc SQL with idempotent code-driven sync (slice S1) |
| 12 | Measurement admin proxy is an allowlist (no SSRF/generic relay); attaches bearer server-side | code review (ALLOWED routes) | keep allowlist style for any new proxy |
| 13 | Dealer pricing / supplier costs never appear in public APIs | CLAUDE.md rule + existing routes | architecture check when touching pricing routes |
| 14 | No fake data: disabled integrations return "Not configured"; truthful empty states everywhere | platform principle, verified in recovery | product-experience gate per changed page |
| 15 | Outbox fencing + transaction retry + order-event ledger semantics | P0–U6 gate (116 tests) | keep suite green at phase boundaries |
| 16 | PWA cache excludes checkout/admin/dealer routes | CLAUDE.md rule | verify on web build changes |
| 17 | Migration journal append-only; prod at 82; migration container may need `--user root` (EACCES lesson) | recovery record | migration-writer discipline |
| 18 | Real provider events are NEVER sent during verification (`NOTIFICATIONS_LIVE_SEND_ENABLED` gating, no-send verification) | env + programme constraint | keep in release gate |
| 19 | `/uploads/*` is served by the edge from the shared media volume; api writes only under MEDIA_STORAGE_ROOT; asset URLs are immutable-cached | W2B live proof (upload→serve E2E) | route-contract may add an asset-serve probe |
| 20 | Media deletion refuses while `media_usages` rows exist (409 ASSET_IN_USE); uploads deduplicate by sha256 | unit suite 4/4 | keep |
| 21 | media_uploads volume owned by uid 1000 (api user `node`); recreating the VOLUME (not container) requires re-chown | W2B EACCES incident + fix | note in release recipe |
| 22 | Campaign LIVE sending is unreachable: no schema vocabulary, use-case LIVE_FORBIDDEN, zero provider imports in the send pipeline; consent gate FAIL-CLOSED | W-SEND live proof + engine suite | any future activation wave must add its own verification evidence before touching this triple lock |
