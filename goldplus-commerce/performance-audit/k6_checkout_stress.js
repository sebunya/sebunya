// k6 heavy profile — NEVER runs against production without the dual gate
// (run_k6.sh enforces it; this script also refuses when __ENV.GP_TARGET is
// the production host and __ENV.GP_PROD_APPROVED !== 'yes').
//
// Profile (owner brief): 0 → 200 VUs over 2 min, hold 200 for 5 min, 200 → 0
// over 1 min. Thresholds: p95 < 500 ms, failure rate < 1 %.
// Journey: homepage → search → product page → add to cart (a cart line only)
// → checkout ENTRY page. Nothing here places an order or touches payment.
import http from 'k6/http';
import { check, sleep } from 'k6';

const TARGET = (__ENV.GP_TARGET || '').replace(/\/+$/, '');
const PRODUCT = __ENV.GP_PRODUCT_URL || '';
const isProd = /(^|\.)shopgoldplus\.com$/i.test(new URL(TARGET || 'https://invalid.local').hostname);
if (!TARGET) throw new Error('GP_TARGET is required');
if (isProd && __ENV.GP_PROD_APPROVED !== 'yes') throw new Error('SKIPPED_FOR_SAFETY: heavy load against production without explicit dual approval');

export const options = {
  stages: [{ duration: '2m', target: 200 }, { duration: '5m', target: 200 }, { duration: '1m', target: 0 }],
  thresholds: { http_req_duration: ['p(95)<500'], http_req_failed: ['rate<0.01'] },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(75)', 'p(90)', 'p(95)', 'p(99)'],
  userAgent: 'goldplus-performance-audit/k6 (heavy profile; approved run)',
};

export default function () {
  const home = http.get(`${TARGET}/`);
  check(home, { 'home 200': (r) => r.status === 200 });
  sleep(1);
  const search = http.get(`${TARGET}/shop?q=charger`);
  check(search, { 'search 200': (r) => r.status === 200 });
  sleep(1);
  if (PRODUCT) {
    const product = http.get(PRODUCT);
    check(product, { 'product 200': (r) => r.status === 200 });
    sleep(1);
    // Add to cart: the same POST the product page form makes (action=add). A cart line, never an order.
    const add = http.post(`${TARGET}/cart`, { action: 'add', productId: __ENV.GP_PRODUCT_ID || '', quantity: '1' }, { redirects: 3 });
    check(add, { 'add-to-cart not 5xx': (r) => r.status < 500 });
    sleep(1);
  }
  const cart = http.get(`${TARGET}/cart`);
  check(cart, { 'cart 200': (r) => r.status === 200 });
  const checkout = http.get(`${TARGET}/checkout`); // entry page only — STOP before any payment step
  check(checkout, { 'checkout entry < 500': (r) => r.status < 500 });
  sleep(2);
}
