import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { performCustomGet, pinnedFetch, MAX_BODY_BYTES } from '../../apps/api/src/infrastructure/seo/adapters/CustomReadOnlyRestAdapter';

const allow = ['api.partner.example'];
const publicDns = async () => ['93.184.216.34'];

describe('custom read-only connector: pinned connect, capped body', () => {
  it('pinnedFetch connects to the checked address, never re-resolving the hostname', async () => {
    let connected = false;
    const server = createServer((sock) => { connected = true; sock.destroy(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    // .invalid never resolves: reaching our socket proves the pinned address was used.
    await pinnedFetch(['127.0.0.1'])(`https://rebind.invalid:${port}/x`).catch(() => {});
    server.close();
    expect(connected).toBe(true);
  });

  it('refuses a body over the cap', async () => {
    const big = 'x'.repeat(MAX_BODY_BYTES + 10);
    const fetchImpl = (async () => new Response(`"${big}"`, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const r = await performCustomGet({ url: 'https://api.partner.example/x', allowedHosts: allow }, fetchImpl, publicDns);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('larger than');
  });

  it('a body that never finishes is cut by the timeout', async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"a":')); } });
    const fetchImpl = (async () => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const p = performCustomGet({ url: 'https://api.partner.example/x', allowedHosts: allow }, fetchImpl, publicDns);
    await vi.advanceTimersByTimeAsync(10_001);
    const r = await p;
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('timed out');
  });
});
