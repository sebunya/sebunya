# Production Scaling Playbook

This runbook guides SREs through scaling GoldPlus Commerce OS components to handle heavy traffic spikes (such as Black Friday promotions).

---

## 1. Database Connection & PgBouncer Scaling
To support more concurrent database sessions without exhaustively allocating PostgreSQL backend threads:
1. **Increase PgBouncer Limit**: Edit `/etc/pgbouncer/pgbouncer.ini` to adjust max client connections.
   ```ini
   max_client_conn = 5000
   default_pool_size = 50
   ```
2. **Increase DB Connection Gauge**: Update `goldplus_db_connections_max` via Prometheus settings to match the new PgBouncer pool ceiling.

---

## 2. Horizontal Scaling of API Nodes
If API node CPU utilization exceeds 70% or event loop lag exceeds 50ms:
1. **Scale API Containers**:
   ```bash
   docker compose -f docker-compose.production.yml up -d --scale api=6 --no-recreate
   ```
2. **Configure Load Balancer**: Ensure the Caddy/Nginx load balancer is configured with a round-robin target list pointing to the new container IPs.

---

## 3. Worker Concurrency Scaling
If job lag (`goldplus_queue_job_lag_seconds`) rises on critical queues:
1. **Increase Worker Concurrency**: Call the queue administration endpoint to increase the worker count without restarting the container:
   ```bash
   curl -X POST https://api.goldplus.com/admin/queues/concurrency \
     -H "Authorization: Bearer <ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"queueName": "telemetry-events", "concurrency": 20}'
   ```
2. **Check Redis Throughput**: Verify that Redis CPU and memory stay within healthy boundaries using `redis-cli info stats`.
