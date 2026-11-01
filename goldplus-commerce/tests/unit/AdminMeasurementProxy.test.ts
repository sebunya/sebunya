import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../../apps/web/src/pages/api/admin/measurement/[...path]';

/**
 * The measurement pages' interactive calls used to carry a bearer token from
 * localStorage that nothing ever set, so every action silently failed with
 * 401. This proxy is the fix: session cookie in, server-attached bearer out,
 * strict allowlist so it can never become a generic authenticated relay.
 * These tests pin that contract.
 */

const call = (handler: typeof GET, path: string, opts: { cookie?: string; url?: string } = {}) =>
  (handler as any)({
    request: new Request(opts.url ?? `http://web.local/api/admin/measurement/${path}`, {
      headers: opts.cookie ? { cookie: opts.cookie } : {},
    }),
    params: { path },
  }) as Promise<Response>;

const SESSION = 'goldplus_session=test-token';

describe('admin measurement same-origin proxy', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses without a session cookie — nothing reaches the API', async () => {
    const response = await call(GET, 'overview');
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forwards an allowlisted GET with the bearer token attached server-side', async () => {
    const response = await call(GET, 'overview', { cookie: SESSION });
    expect(response.status).toBe(200);
    const [, init] = (fetch as any).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('refuses paths outside the allowlist — no generic relay', async () => {
    for (const path of ['users', 'dlq/../../users', 'overview/extra', 'consent-audit/x', '']) {
      const response = await call(GET, path, { cookie: SESSION });
      expect(response.status, path).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('binds each path to its method: replay is POST-only, reads are GET-only', async () => {
    expect((await call(GET, 'dlq/abc-123/replay', { cookie: SESSION })).status).toBe(404);
    expect((await call(POST, 'overview', { cookie: SESSION })).status).toBe(404);
    expect((await call(POST, 'dlq/abc-123/replay', { cookie: SESSION })).status).toBe(200);
  });

  it('forwards only allowlisted, well-formed query parameters', async () => {
    await call(GET, 'match-quality', {
      cookie: SESSION,
      url: 'http://web.local/api/admin/measurement/match-quality?days=7&evil=<script>&limit=999999999999999999999',
    });
    const [upstream] = (fetch as any).mock.calls[0];
    const url = new URL(String(upstream));
    expect(url.searchParams.get('days')).toBe('7');
    expect(url.searchParams.has('evil')).toBe(false);
    // 'limit' is not on match-quality's allowlist, and the oversized value
    // fails the shape check anyway.
    expect(url.searchParams.has('limit')).toBe(false);
  });

  it('reports upstream failure as 502 without inventing data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const response = await call(GET, 'overview', { cookie: SESSION });
    expect(response.status).toBe(502);
    const body: any = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});
