import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Readiness answers one question: should the load balancer send traffic here?
 *
 * Treating a degradable dependency as fatal gets that wrong in the most
 * expensive direction. Every replica sees the same Redis, so a Redis blip made
 * all of them report unready at the same instant, and the load balancer pulled
 * the entire fleet — a total site outage caused by a cache, which is strictly
 * worse than the degradation it was reacting to.
 */
const source = readFileSync(
  join(__dirname, '../../apps/api/src/interfaces/http/routes/health.ts'),
  'utf8',
);

const readyBlock = source.slice(
  source.indexOf("routes.get('/ready'"),
  source.indexOf('3. DEEP HEALTH'),
);

describe('liveness', () => {
  it('checks no dependency at all', () => {
    // A liveness probe that checks the database restarts every instance during
    // a database incident, which removes the capacity that would have recovered.
    const live = source.slice(source.indexOf('function livenessResponse'), source.indexOf('2. READINESS'));
    expect(live).not.toMatch(/await|postgres|redis|Registry/);
    expect(live).toContain("status: 'alive'");
  });
});

describe('readiness separates "cannot serve" from "impaired"', () => {
  it('keeps two distinct flags rather than one', () => {
    expect(readyBlock).toContain('let overallHealthy = true;');
    expect(readyBlock).toContain('let degraded = false;');
  });

  it('treats PostgreSQL as fatal — without it the service cannot answer', () => {
    const pg = readyBlock.slice(readyBlock.indexOf('healthMetrics.postgresError'));
    expect(pg.slice(0, 300)).toContain('overallHealthy = false');
  });

  it('treats Redis as degraded, not unready', () => {
    const redis = readyBlock.slice(readyBlock.indexOf('const queueService'));
    expect(redis).toContain('degraded = true');
    expect(redis.slice(0, 600)).not.toContain('overallHealthy = false');
  });

  it('treats abuse-control fallback as degraded, not unready', () => {
    const abuse = readyBlock.slice(readyBlock.indexOf('const abuse = await'));
    expect(abuse).toContain('degraded = true');
  });

  it('treats an invalid proxy topology as fatal', () => {
    // A service that cannot say how it is exposed cannot say who its callers
    // are, and every abuse control downstream depends on that answer.
    const proxy = readyBlock.slice(readyBlock.indexOf('proxyConfig()'));
    expect(proxy.slice(0, 500)).toContain('overallHealthy = false');
  });

  it('reports degraded truthfully instead of hiding it inside ready', () => {
    expect(readyBlock).toContain("degraded ? 'degraded' : 'ready'");
  });

  it('still serves traffic while degraded', () => {
    expect(readyBlock).toContain('overallHealthy ? 200 : 503');
  });

  it('reports the proxy mode without exposing network detail', () => {
    const proxy = readyBlock.slice(readyBlock.indexOf('proxy_topology'), readyBlock.indexOf('abuse_controls'));
    expect(proxy).toContain('mode');
    expect(proxy).toContain('trusted_hops');
    expect(proxy).not.toMatch(/host|address|ip\b|range/i);
  });
});

describe('deep health surfaces the outbox operating state', () => {
  it('reports dead letters, which were previously invisible', () => {
    // Until 0054 an exhausted event was recorded as 'processed', so no health
    // signal could distinguish a failed delivery from a successful one.
    expect(source).toContain('dead_lettered');
  });

  it('reports stuck workers via expired leases', () => {
    expect(source).toContain('expired_leases');
  });

  it('reports queue depth and the age of the oldest pending event', () => {
    expect(source).toContain('oldest_pending_age_seconds');
    expect(source).toContain('pending:');
  });

  it('degrades on dead letters or stuck leases rather than reporting healthy', () => {
    const block = source.slice(source.indexOf('outbox_operations'));
    expect(block).toContain("'degraded' : 'healthy'");
  });
});
