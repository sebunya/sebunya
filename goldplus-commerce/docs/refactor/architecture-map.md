# Architecture Map

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, read-only audit only.

## Workspace

```text
goldplus-commerce
  apps/api        Hono API, Clean Architecture layers, Drizzle, queues, telemetry
  apps/web        Astro storefront/admin SSR app, Tailwind, service worker
  packages/shared shared DTOs, permissions, recommendation/event types
  tests           unit and architecture fitness tests
  docs            production and pass documentation
```

## Package Boundaries

- Root package provides workspace scripts and shared dev dependencies.
- `@goldplus/api` owns HTTP API, domain, application, infrastructure, DB schema, queues, observability.
- `@goldplus/web` owns storefront pages, admin pages, layouts, components, static assets.
- `@goldplus/shared` owns API envelopes, product DTOs, permissions, recommendation event and analytics types.

## API Layer Map

```text
interfaces/http
  app.ts, server.ts
  middleware: auth, permissions, rate limit, maintenance, customer session, bot detection
  routes: auth, products, commerce, governance, webhooks, account, health, metrics, telemetry, recommendations, admin/*

application
  ports
  use-cases grouped by domain
  recommendations services/use cases

domain
  products, orders, payments, recommendations, governance, identity, etc.

infrastructure
  db repositories and schema
  payments, notifications, queues, observability, telemetry, security, deployment
```

## Current Dependency Direction

Intended:

```text
HTTP routes -> application use cases -> ports -> infrastructure adapters
domain -> no framework/db/adapter imports
shared -> no app-specific infrastructure
```

Observed:

- Domain purity tests pass.
- Routes frequently resolve concrete dependencies through `Registry`.
- Some application use cases import infrastructure directly, especially telemetry.
- Architecture tests currently exempt known leaks.
- Registry composes nearly all concrete adapters eagerly enough that health/metrics can touch broad subsystems.

## Storefront Map

```text
layouts
  BaseLayout, AdminLayout

components
  Header, ProductCard, forms, notices, admin table/header, recommendation rails

pages
  public storefront: index, shop, product detail, cart, checkout, quote, support, verification
  account/admin: account, admin dashboard/modules/login
  operational: offline, 404, 500, sitemap, robots

lib
  api helpers, catalog fallback, cart/session, checkout, validation, telemetry, recommendations
```

## Deployment Map

```text
postgres -> pgbouncer -> api -> web -> caddy
redis --------^        ^ queue workers
prometheus/grafana/node-exporter for monitoring
sgtm-production/preview via Caddy metrics subdomain
```

Current coupling concern:

- `api` depends on PgBouncer and Redis health.
- `web` depends on `api: service_healthy`.
- `caddy` depends on both `web` and `api` health.
- API and Grafana both publish host port 3000.

## Protected Recommendation System Map

Protected files inspected read-only include:

- `apps/api/src/application/recommendations/*`
- `apps/api/src/domain/recommendations/*`
- `apps/api/src/interfaces/http/routes/recommendations.ts`
- `apps/api/src/interfaces/http/routes/admin/recommendations.ts`
- `apps/web/src/components/recommendations/*`
- `apps/web/src/lib/recommendations.ts`
- `apps/web/src/lib/admin-recommendations.ts`
- `apps/web/src/lib/homepage-merchandising.ts`
- `packages/shared/src/recommendations.ts`
- recommendation unit tests

Protected behavior must not be changed without explicit approval and rollback plan.

