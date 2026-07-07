# Reliability Hardening Report

This report documents the architectural patterns and implementations introduced to achieve 99.99% availability and elite partition tolerance for the GoldPlus Commerce OS production stack.

---

## 1. Zero-Downtime Container Graceful Shutdown
To prevent dropped connections and data corruption during rolling Kubernetes/Docker updates:
- **HTTP Server**: Wrapped the Hono HTTP server in a shutdown hook. When receiving `SIGTERM` or `SIGINT`, the server executes `server.close()`, which stops accepting new connections while letting active requests finish processing (up to a 10-second timeout).
- **BullMQ Workers**: Integrated parallel queue worker draining via `await worker.close()` in `QueueService.ts`. In-progress background jobs are allowed to complete, while the worker stops fetching new items from Redis.
- **IORedis Reconnect Storm Prevention**: Added randomized backoff with a +/- 200ms jitter to the Redis client connection `retryStrategy` to prevent thundering herd behavior when Redis instances failover.

---

## 2. Database Resilience and Auto-Retry Loop
Database connections are protected by a connection pooler (PgBouncer) and transaction-level automatic retries:
- **Deadlock and Serialization Failures**: Database transactions wrapped in `client.begin` automatically catch Postgres errors `40P01` (deadlock detected) and `40001` (serialization failure).
- **Jittered Backoff Retry**: Transactions are retried up to 3 times with exponential backoff and randomized jitter to allow concurrent transactions to complete.
- **System Health Monitor**: `DrizzleSystemHealthRepository.ts` monitors active database locks, idle-in-transaction connections, prepared statements count, WAL sizes, and active replication lag to alert SREs of degradation.

---

## 3. Dynamic Backpressure & Queue Throttling
Queue workers dynamically throttle their concurrency in response to resource exhaustion:
- **Metrics Feedback**: An adaptive monitor continuously tracks average PostgreSQL query latency and Node.js event loop lag.
- **Worker Throttle**: If query latency exceeds 200ms or event loop lag exceeds 100ms, the monitor automatically scales down worker concurrency. Concurrency is restored once health metrics stabilize.

---

## 4. SSRF and DNS Rebinding Prevention
To secure outbound HTTP requests from the commerce engine (such as payment callbacks and webhooks):
- **DNS Resolution Check**: The `resilientFetch` client resolves the target domain's IP addresses before making any HTTP request.
- **Private IP Blocking**: Any IP address resolving to local loopbacks (`127.0.0.0/8`, `::1`), private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.169.254`), or multicast ranges is blocked.
- **Exemptions**: Explicitly allowlisted internal hostnames (e.g. `sgtm-production`) bypass this check to allow secure local server-to-server communications.

---

## 5. Deployment Lock and Write-Freeze
During sensitive migrations or major releases, SREs can put the system into a deployment freeze:
- **Maintenance Middleware**: Intercepts all write requests (HTTP `POST`, `PUT`, `PATCH`, `DELETE`) globally.
- **Fail-Safe Response**: Returns a structured `503 Service Unavailable` with `SYSTEM_UNDER_MAINTENANCE` code, letting frontend apps render an elegant maintenance view.
- **Exemptions**: Core system health check routes (`/health/*`), Prometheus metrics (`/metrics`), and admin deployment control paths are exempted to ensure SRE visibility remains 100% active.
