import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { floorPriceRedaction, INTERNAL_KEY_HEADER } from '../../src/interfaces/http/middleware/floorPriceRedaction';

/**
 * A product's floor (Price A) reaches only the storefront's own SSR and admin.
 * Every other caller gets JSON without any floorPriceUgx key (2026-09-18).
 */
const KEY = 'k'.repeat(48);
const product = { id: 'p1', retailPriceUgx: 100000, floorPriceUgx: 55000, nested: [{ floorPriceUgx: 1, keep: 2 }] };

const app = () => {
  const a = new Hono();
  a.use('*', floorPriceRedaction());
  a.get('/products', (c) => c.json({ success: true, data: [product] }));
  a.get('/admin/products/p1', (c) => c.json({ success: true, data: product }));
  a.get('/text', (c) => c.text('floorPriceUgx'));
  return a;
};

describe('floor price redaction', () => {
  const saved = process.env.INTERNAL_API_KEY;
  beforeEach(() => { process.env.INTERNAL_API_KEY = KEY; });
  afterEach(() => { process.env.INTERNAL_API_KEY = saved; });

  it('strips every floorPriceUgx, at any depth, for a public caller', async () => {
    const res = await app().request('/products');
    const text = await res.text();
    expect(text).not.toContain('floorPriceUgx');
    expect(JSON.parse(text).data[0]).toEqual({ id: 'p1', retailPriceUgx: 100000, nested: [{ keep: 2 }] });
    expect(res.status).toBe(200);
  });

  it('keeps it for the storefront SSR presenting the internal key', async () => {
    const res = await app().request('/products', { headers: { [INTERNAL_KEY_HEADER]: KEY } });
    expect((await res.json()).data[0].floorPriceUgx).toBe(55000);
  });

  it('a wrong key is a public caller', async () => {
    const res = await app().request('/products', { headers: { [INTERNAL_KEY_HEADER]: 'x'.repeat(48) } });
    expect(await res.text()).not.toContain('floorPriceUgx');
  });

  it('fails closed: with no key configured nobody is internal', async () => {
    delete process.env.INTERNAL_API_KEY;
    const res = await app().request('/products', { headers: { [INTERNAL_KEY_HEADER]: '' } });
    expect(await res.text()).not.toContain('floorPriceUgx');
  });

  it('a short configured key is refused rather than trusted', async () => {
    process.env.INTERNAL_API_KEY = 'short';
    const res = await app().request('/products', { headers: { [INTERNAL_KEY_HEADER]: 'short' } });
    expect(await res.text()).not.toContain('floorPriceUgx');
  });

  it('leaves admin routes (permission-guarded) and non-JSON untouched', async () => {
    expect((await (await app().request('/admin/products/p1')).json()).data.floorPriceUgx).toBe(55000);
    expect(await (await app().request('/text')).text()).toBe('floorPriceUgx');
  });
});
