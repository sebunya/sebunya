import { afterEach, expect, test, describe, vi } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';
import { Registry } from '../../apps/api/src/infrastructure/Registry';

function stubHealthySystemMetrics() {
  const registry = Registry.getInstance();
  return vi.spyOn(registry.checkSystemHealthUseCase, 'execute').mockResolvedValue({
    postgresLatencyMs: 3,
    dbSaturation: {
      activeConnections: 2,
      maxConnections: 100,
      status: 'healthy',
    },
    dbAdditionalMetrics: {
      idleInTransactionConnections: 0,
      lockWaitingQueries: 0,
      preparedStatementsCount: 0,
      walSizeBytes: 0,
      activeReplicationStandbys: 0,
    },
    outboxLagMs: 0,
  });
}

describe('Observability & Health API Endpoints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('GET /health remains a liveness alias with correlation headers', async () => {
    const res = await app.request('/health', {
      headers: { 'x-correlation-id': 'obs-health-root' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-correlation-id')).toBe('obs-health-root');
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.data.status).toBe('alive');
  });

  test('GET /health/live returns 200 alive', async () => {
    const res = await app.request('/health/live');
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.data.status).toBe('alive');
  });

  test('GET /health/ready reports dependency readiness', async () => {
    stubHealthySystemMetrics();

    const res = await app.request('/health/ready');
    // Readiness now separates "cannot serve" from "impaired". Only a fatal
    // dependency (PostgreSQL, or an invalid proxy topology) makes an instance
    // unready; an impaired one keeps serving and is reported as degraded, so a
    // Redis blip no longer pulls the whole fleet out of rotation at once.
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.data.status).not.toBe('unready');
    expect(['ready', 'degraded']).toContain(data.data.status);
    expect(data.data.subsystems.postgres.status).toBe('healthy');
    expect(data.data.subsystems.redis.status).toBe('healthy');
    // There is no Redis in this environment, so the abuse controls are running
    // on their local fallback — reported truthfully rather than as healthy.
    expect(data.data.subsystems.abuse_controls.status).toBe('degraded');
    expect(data.data.subsystems.proxy_topology.status).toBe('healthy');
  });

  test('GET /metrics returns 200 and prometheus metrics format', async () => {
    stubHealthySystemMetrics();
    const startedAt = Date.now();
    const res = await app.request('/metrics');
    const elapsedMs = Date.now() - startedAt;

    expect(res.status).toBe(200);
    expect(elapsedMs).toBeLessThan(2000);

    const text = await res.text();
    expect(text).toContain('goldplus_db_connections_active');
    expect(text).toContain('goldplus_db_connections_max');
    expect(text).toContain('goldplus_queue_jobs');
    expect(text).toContain('goldplus_metrics_db_collection_up');
    expect(text).toContain('goldplus_metrics_queue_collection_up');
    expect(text).toContain('goldplus_metrics_collection_duration_seconds');
  });
});
