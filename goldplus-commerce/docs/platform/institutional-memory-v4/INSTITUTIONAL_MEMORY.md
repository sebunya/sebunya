# GoldPlus institutional memory — V4/V5 programme
Generated 2026-08-03 at SHA `707876d` (branch `claude/amazon-grade-goldplus-commerce-os-v5-production-20260802`, PR #9).
Model/effort attestation: MODEL_REQUESTED=Fable 5 · EFFORT_REQUESTED=max · THINKING_REQUESTED=enabled · runtime model id `claude-fable-5` (operator switched via `/model` + `/effort max`; visible status line is operator evidence per F14).

## What this platform is
Modular-monolith commerce OS (Clean/Hexagonal, DDD): Astro SSR storefront+admin (`apps/web`, 124 pages) → Hono API (`apps/api`, ~293 handlers over 55 mounts) → Drizzle/PostgreSQL (82 applied migrations in prod) + Redis (BullMQ queues, abuse controls) — deployed via Docker Compose behind Caddy on Hetzner (`goldplus-prod`, `/opt/goldplus/app/goldplus-commerce`, public `https://shopgoldplus.com`, API `https://api.shopgoldplus.com`). 2× web + 2× api replicas; postgres, redis, pgbouncer (pinned by digest, currently UNUSED by the API — DATABASE_URL targets postgres:5432 directly), prometheus/grafana/pghero/node-exporter, sGTM (2 containers).

## Programme lineage (do not re-derive)
- P0-2 ledger + U1–U6 units: complete, committed, 116-test gate green, parity 76/76 (see docs/platform/amazon-grade-v5/).
- Platform Modules admin surface (6 modules: promotions/coupons, reviews moderation, creators, flash sales, device compatibility, SEO/redirects) with permission-guarded admin API at `/admin/modules` — deployed.
- 2026-08-03 platform-wide production recovery: RC-1…RC-7 all fixed, deployed, verified live (docs/production-recovery/2026-08-03-platform-wide/: ROOT_CAUSE_REGISTER, MODULE_CAPABILITY_MATRIX, FINAL_REPORT). Terminal state GOLDPLUS_PLATFORM_PRODUCTION_RECOVERED.

## Root causes fixed in production (institutional scar tissue — protect against regression)
| RC | Lesson |
|----|--------|
| RC-1 | Astro `import.meta.env.PUBLIC_*` inlines at BUILD time; `?? fallback` does NOT catch `''`. SSR must use runtime `INTERNAL_API_ORIGIN` (http://api:3000), browser uses public origin. Canonical resolver lives in `apps/web/src/lib/api.ts` and 78 files consume `apiBase` from it. |
| RC-2 | Server-side proxies (measurement `[...path].ts`) must prefer INTERNAL_API_ORIGIN, empty-safe. |
| RC-3 | The storefront is the BFF that MINTS signed cart credentials (`__Host-gp_cart`) and checkout intents; web+api MUST share `CART_CREDENTIAL_SECRET`/`CHECKOUT_INTENT_SECRET` (dedicated, in gitignored `.env.production`, wired in compose to BOTH services). Empty secret ⇒ keys() returns null ⇒ silent local-only basket. |
| RC-4 | Never gate a service's startup on infrastructure it does not use; pin third-party images by digest (`edoburu/pgbouncer@sha256:4c1ca29…`, LISTEN_PORT=6432). API depends_on postgres+redis only. |
| RC-5 | SyntheticMonitor write stages (real order + payment webhook) are gated OFF by `SYNTHETIC_MONITOR_WRITE_STAGES_ENABLED` (default false). Read-only journey is the health signal. Never "fix" the monitor into creating prod orders. |
| RC-6 | `parseLocalCartCookie` must emit `unitPriceUgx` (+ `slug`) because `cart.astro` consumes those names; mismatch rendered `UShNaN`. |
| RC-7 | Server cart is created idempotently on first ADD inside `MutateCartUseCase.mutate()` (repo `create()` with onConflictDoNothing). Checkout prices client-sent items via server-side price resolution — the server cart is corroborating, not the checkout item source. |

## Production operational facts
- Compose interpolation requires `--env-file .env.production` on EVERY build/up (compose auto-loads only `.env`).
- Drizzle migrator needs all `.sql` files readable (EACCES was masked as "No file …found"); prod at 82 migrations; backups at `/root/goldplus-db-backups/`.
- Bootstrap admin (Robert) authenticates via `BOOTSTRAP_ADMIN_EMAIL/PASSWORD` env; Owner role currently holds 92 permissions after recovery re-grant. Permission codes are `action.resource` split as action=first segment, resource=second (e.g. `products.read` ⇒ action=products, resource=read) — a reversed insert during recovery produced wrong codes; the sync must be code-driven, never hand-SQL (motivates §6 governed-admin slice).
- PROXY_TOPOLOGY_MODE=CADDY_EDGE required (clientAddress guard). Readiness reports postgres/redis/proxy_topology/abuse_controls/zeptomail/sms.
- Rollback images tagged `goldplus-commerce-{web,api}:rollback-*` on host; deploys are `up -d api web` after building with env-file.
- Playwright route-contract suite: `tests/e2e/route-contract.spec.ts` (E2E_WEB_BASE/E2E_API_BASE/E2E_ADMIN_EMAIL/PASSWORD).
- gh CLI is UNAUTHENTICATED on this Mac: branch pushes update PR #9 content automatically; PR body edits need operator `gh auth login`.

## Known-good live behaviour (verified 2026-08-03)
33/34 admin pages HTTP 200 no failure banners (only `/admin/deployment` has no page — API mount only); public funnel E2E: mint `__Host-gp_cart` → BFF add → server cart `{unitPriceUgx:50000, subtotalUgx:50000}` → page renders `USh 50,000`; storefront lists 8 products; BullMQ queues active (analytics-fanout, webhook-retries, telemetry-dispatch, recommendation-processing, email-jobs); synthetic read journey green (~215ms).

## Weak layers (from live inspection — feed the maturity matrix)
- Cart TTL 30 days (constants `CART_CREDENTIAL_TTL_SECONDS`=30d, `CART_TTL_DAYS`=30) vs §11 requirement 180d.
- Role governance: single "Owner" role, ad-hoc SQL grants, no idempotent code-driven sync, no maker/checker/MFA/access-review.
- No unit tests existed for the cart use case (RC-6/RC-7 shipped untested — now a required regression suite).
- pgbouncer unused by API (pooling benefit unrealised — deliberate follow-up, not urgent).
- Cart page still carries a local-cookie fallback path double-standard (server cart is primary post-RC-7).
- `/admin/platform-modules` is a consolidated read surface, not yet the §9 capability hub.
- Legal pages are static (§7 CMS not built). DAM (§8) not built; product images come from catalogue URLs.
