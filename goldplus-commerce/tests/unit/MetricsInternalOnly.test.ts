import { describe, it, expect } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';

/**
 * /metrics is for Prometheus on the Docker network. From the edge every
 * request carries the forwarded-for headers Caddy stamps; the scraper's do
 * not. Proven publicly readable on 2026-09-12.
 */
describe('/metrics is reachable only from inside the network', () => {
  it('answers 404 to a request that came through the edge', async () => {
    for (const headers of [{ 'x-forwarded-for': '41.84.203.9' }, { 'x-real-ip': '41.84.203.9' }, { 'x-forwarded-for': '172.68.47.142', 'x-real-ip': '172.68.47.142' }]) {
      const res = await app.request('/metrics', { headers });
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('# HELP');
    }
  });

  it('still serves the scraper, which carries no forwarded headers', async () => {
    const res = await app.request('/metrics');
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(401);
  });
});
