import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from '../../../apps/web/src/pages/sitemaps/products.xml';

afterEach(() => vi.unstubAllGlobals());

describe('products sitemap on API failure', () => {
  it('returns 503 with Retry-After, never an empty urlset', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('down'); });
    const r = await (GET as any)({});
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('300');
  });
  it('a non-ok API answer is a 503 too', async () => {
    vi.stubGlobal('fetch', async () => new Response('x', { status: 500 }));
    expect((await (GET as any)({})).status).toBe(503);
  });
  it('a good answer lists products', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: [{ slug: 'a-b', updatedAt: '2026-11-01' }] }), { status: 200 }));
    const r = await (GET as any)({});
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('/products/a-b');
  });
});
