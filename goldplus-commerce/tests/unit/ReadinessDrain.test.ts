import { describe, it, expect, afterEach } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';
import { beginDraining, isDraining, resetDrainingForTests } from '../../apps/api/src/interfaces/http/lifecycle';

describe('Slice 3F — readiness false before drain', () => {
  afterEach(() => resetDrainingForTests());

  it('starts not draining', () => {
    expect(isDraining()).toBe(false);
  });

  it('/health/ready returns 503 draining once shutdown begins — before any DB probe', async () => {
    beginDraining();
    const res = await app.request('/health/ready');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('draining');
    expect(body.ready).toBe(false);
    expect(body.subsystems.lifecycle.status).toBe('draining');
  });

  it('/health/live is unaffected by draining (the process is still alive)', async () => {
    beginDraining();
    const res = await app.request('/health/live');
    // Liveness must not fail during drain, or an orchestrator would kill the pod
    // mid-shutdown instead of letting it finish in-flight work.
    expect(res.status).toBe(200);
  });

  it('resets cleanly for tests', () => {
    beginDraining();
    expect(isDraining()).toBe(true);
    resetDrainingForTests();
    expect(isDraining()).toBe(false);
  });
});
