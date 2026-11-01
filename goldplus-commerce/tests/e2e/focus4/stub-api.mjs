// Focus 4 evidence — a stub of the API surface the product page reads, serving
// clearly labelled TEST fixtures. Never points at production; never writes.
//   node tests/e2e/focus4/stub-api.mjs [port]     (default 3999)
import http from 'node:http';

const port = Number(process.argv[2] || 3999);
const ok = (data) => JSON.stringify({ success: true, data });
const fail = (code, message) => JSON.stringify({ success: false, error: { code, message } });

const asset = (n) => `/uploads/assets/f${n}/fixture${n}fixture/pdp.webp`;
const product = (slug, imageCount, name) => ({
  id: `00000000-0000-4000-8000-00000000000${imageCount}`,
  slug,
  name,
  categoryName: 'Sound',
  shortDescription: 'TEST FIXTURE. Wireless earbuds with a charging case; this text is placeholder copy for layout evidence only.',
  longDescription: 'TEST FIXTURE paragraph one. Nothing here describes a real product.\n\nTEST FIXTURE paragraph two: a second paragraph so the details section has body text below the buying actions.',
  sku: 'GP03BT',
  modelNumber: 'GP03BT',
  retailPriceUgx: 145000,
  floorPriceUgx: 145000,
  availability: { kind: 'in_stock', quantity: 12 },
  hasImage: imageCount > 0,
  primaryImageUrl: imageCount > 0 ? asset(1) : null,
  verifiedSpecs: { 'Bluetooth version': '5.3', 'Battery (case)': '400 mAh' },
  hasMissingSpecs: false,
  images: Array.from({ length: imageCount }, (_, i) => ({ url: asset(i + 1), alt: `TEST FRAME ${i + 1} of ${imageCount}` })),
  attributeValues: [
    { name: 'Bluetooth version', unit: null, value: '5.3', isVerified: true },
    { name: 'Battery (case)', unit: 'mAh', value: '400', isVerified: true },
  ],
});

const FOUR = product('goldplus-bluetooth-gp03bt', 4, 'GoldPlus Bluetooth Earbuds GP03BT (TEST FIXTURE, four frames)');
const ONE = product('fixture-one-image', 1, 'Fixture product with one image (TEST FIXTURE)');
const NONE = product('fixture-no-image', 0, 'Fixture product with no image (TEST FIXTURE)');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  res.setHeader('Content-Type', 'application/json');
  const send = (status, body) => { res.statusCode = status; res.end(body); };
  if (req.method !== 'GET') return send(200, ok({ accepted: true }));
  if (p === '/products/goldplus-bluetooth-gp03bt') return send(200, ok(FOUR));
  if (p === '/products/fixture-one-image') return send(200, ok(ONE));
  if (p === '/products/fixture-no-image') return send(200, ok(NONE));
  if (/^\/products\/[^/]+\/compatibility$/.test(p)) return send(200, ok([]));
  // Empty catalogue list: keeps the fallback "browse" rail from rendering the fixture's own
  // cover as a card, so the gallery's network trace measures the gallery alone.
  if (p === '/products') return send(200, ok([]));
  if (p.startsWith('/recommendations')) return send(200, ok({ items: [], placement: url.searchParams.get('placement') ?? '', algoVersion: 'stub', strategy: 'stub' }));
  // Singleton documents (business info, taxonomy, nav, copy, loyalty, lifecycle) are NOT stubbed:
  // the storefront's readers fall back to their built-in defaults on a 404, which is the honest local state.
  if (p === '/delivery/quote') return send(200, fail('NOT_CONFIGURED', 'Not configured'));
  if (p.startsWith('/batteries')) return send(404, fail('NOT_FOUND', 'stub'));
  return send(404, fail('NOT_FOUND', `stub has no ${p}`));
}).listen(port, '127.0.0.1', () => console.log(`focus4 stub api on http://127.0.0.1:${port}`));
