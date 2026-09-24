import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import app from '../../apps/api/src/interfaces/http/app';
import { beginDraining, resetDrainingForTests } from '../../apps/api/src/interfaces/http/lifecycle';

/**
 * /metrics was locked to internal callers; /health/deep and /health/ready were not,
 * so anyone could read database saturation, outbox backlog, provider configuration
 * and — during a database incident — the raw driver error text.
 */
const external = { 'X-Forwarded-For': '203.0.113.9', 'X-Real-IP': '203.0.113.9' };

afterEach(() => resetDrainingForTests());

describe('health detail is for internal callers only', () => {
  it('/health/deep is not found from outside', async () => {
    const res = await app.request('/health/deep', { headers: external });
    expect(res.status).toBe(404);
  });

  it('/health/ready keeps its public status code but gives outsiders only { status }', async () => {
    beginDraining();
    const res = await app.request('/health/ready', { headers: external });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'draining' });
  });

  it('internal callers still get the subsystem detail', async () => {
    beginDraining();
    const res = await app.request('/health/ready');
    expect((await res.json()).subsystems.lifecycle.status).toBe('draining');
  });

  it('never returns raw driver or fetch error text', () => {
    const source = readFileSync(join(__dirname, '../../apps/api/src/interfaces/http/routes/health.ts'), 'utf8');
    expect(source).not.toMatch(/error:\s*healthMetrics\.postgresError/);
    expect(source).not.toMatch(/errorMessage\(err\)/);
  });
});
