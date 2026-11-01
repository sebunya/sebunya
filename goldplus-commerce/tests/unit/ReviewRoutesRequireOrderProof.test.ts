import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from '../../apps/api/node_modules/hono';

/**
 * The public review routes may only ever touch the shopper's OWN order. They
 * prove it exactly as order tracking does (reference + checkout phone/email,
 * shared lockout) BEFORE any review use case runs. And POST /reviews reads
 * the JSON body twice (once inside the proof, once for the rating), which is
 * only safe because Hono caches a parsed body; that is pinned here too, so a
 * framework upgrade that changed it fails a test instead of every review.
 */
const src = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'), 'utf8');
const handler = (route: string) => {
  const start = src.indexOf(route);
  expect(start, `${route} exists`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\nroutes.', start + route.length));
};

describe('review routes prove the order first', () => {
  for (const route of ["routes.post('/reviews/eligibility'", "routes.post('/reviews'"]) {
    it(`${route} verifies the order before calling a review use case`, () => {
      const body = handler(route);
      const proof = body.indexOf('await verifyOrderRequest(c)');
      const useCase = body.search(/registry\.(orderReviewEligibilityUseCase|submitOrderReviewUseCase)/);
      expect(proof).toBeGreaterThan(-1);
      expect(useCase).toBeGreaterThan(proof);
      expect(body).toMatch(/if \(!verified\.ok\) return/);
    });
  }

  it('the public read returns published reviews only and never a raw identity', () => {
    const body = handler("routes.get('/reviews/products/:productId'");
    expect(body).toMatch(/UUID_RE\.test\(productId\)/);
    expect(body).not.toMatch(/customerIdentityHash|customer_identity_hash|orderItemId|customerPhone/);
  });
});

describe('the framework behaviour the submit route relies on', () => {
  it('Hono returns the same parsed JSON body on a second read', async () => {
    const app = new Hono();
    app.post('/x', async (c) => {
      const first = await c.req.json();
      const second = await c.req.json();
      return c.json({ first, second });
    });
    const res = await app.request('/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: 'GP-1', rating: 5 }) });
    expect(await res.json()).toEqual({ first: { reference: 'GP-1', rating: 5 }, second: { reference: 'GP-1', rating: 5 } });
  });
});
