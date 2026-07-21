# ANTI-GRAVITY RUNTIME TOPOLOGY MODEL

**Generated:** 2026-07-21T08:25:00Z  
**Target Architecture:** Modular Monolith Node.js/Hono + Astro SSR  
**Container Orchestration:** Docker Compose (`docker-compose.production.yml`)  

---

## 1. Network Topology & Port Mapping

```
                                [ Public Internet ]
                                         │
                                  (80 / 443 TLS)
                                         ▼
                                  ┌─────────────┐
                                  │    Caddy    │
                                  │ Edge Proxy  │
                                  └──────┬──────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │                                           │
          (http://web:4321)                          (http://api:3000)
                   ▼                                           ▼
          ┌─────────────────┐                         ┌─────────────────┐
          │     web         │ ── internal fetch ───►  │     api         │
          │  (Astro SSR)    │                         │  (Hono Node)    │
          └─────────────────┘                         └────────┬────────┘
                                                               │
                                       ┌───────────────────────┼───────────────────────┐
                                       ▼                       ▼                       ▼
                              ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
                              │    PostgreSQL   │     │      Redis      │     │  sGTM / CDP     │
                              │   (Port 5432)   │     │   (Port 6379)   │     │  (Port 8080)    │
                              └─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 2. Process & Worker Model

### Primary Application Process (`apps/api/src/interfaces/http/server.ts`)
- Starts Hono HTTP listener on port 3000.
- Boots DI Composition Root (`Registry.getInstance()`).
- Starts 3 background polling tickers:
  1. `OutboxTicker` (30s interval for transaction outbox events)
  2. `RecommendationMaterializer` (1h interval)
  3. `SyntheticMonitor` (5m interval for synthetic commerce checks)
- Registers 5 BullMQ worker queue consumers (`QueueWorkers.ts`):
  - `TELEMETRY_DISPATCH`
  - `WEBHOOK_RETRIES`
  - `EMAIL_JOBS`
  - `RECOMMENDATION_PROCESSING`
  - `ANALYTICS_FANOUT`

## 3. Storage & Persistence Tier
- **PostgreSQL**: Drizzle ORM, 49 migrations (ceiling `0048`), 57 repositories.
- **Redis**: Queue state management for BullMQ.
- **Transactional Outbox**: Guaranteed event delivery pattern.

## 4. Security & Protection Perimeter
- Strict rate limiting: 1,000 req/min global, 10 req/min auth, 100 req/s telemetry.
- Global RBAC enforcement: 78 permission strings checked via `requirePermissions`.
- Server-authoritative checkout & pricing.
- Consent-aware telemetry dispatch.
