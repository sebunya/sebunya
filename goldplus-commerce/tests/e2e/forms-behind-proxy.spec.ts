import { test, expect } from '@playwright/test';
import { request as httpRequest } from 'node:http';

/**
 * Form posts as production delivers them: Caddy terminates HTTPS and forwards Host + X-Forwarded-Proto to the web
 * container over plain http. Astro's origin check must accept the shop's own origin and still refuse a foreign one.
 * (Regression: from the Astro 6 upgrade on 2026-10-07, with no security.allowedDomains, every request was rebuilt
 * as http://localhost:4321 and every real form post was refused with "Cross-site POST form submissions are
 * forbidden": add to cart, checkout, login, quotes. CI never saw it because it talks to the container directly.)
 */
const base = new URL(process.env.E2E_WEB_BASE ?? 'http://127.0.0.1:4321');

function postAsCaddy(path: string, origin: string, host = 'shopgoldplus.com'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = 'action=add&productId=00000000-0000-4000-8000-000000000000&quantity=1';
    const req = httpRequest({
      host: base.hostname, port: base.port || 80, path, method: 'POST',
      headers: { Host: host, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.7', Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data.slice(0, 200) })); });
    req.on('error', reject);
    req.end(body);
  });
}

for (const path of ['/cart', '/checkout', '/quote-request', '/login']) {
  test(`a same-site form post to ${path} behind the proxy is not refused as cross-site`, async () => {
    const own = await postAsCaddy(path, 'https://shopgoldplus.com');
    expect(own.body).not.toContain('Cross-site');
    expect(own.status).not.toBe(403);
    const www = await postAsCaddy(path, 'https://www.shopgoldplus.com', 'www.shopgoldplus.com');
    expect(www.body).not.toContain('Cross-site');
  });
}

test('a foreign origin is still refused', async () => {
  const evil = await postAsCaddy('/cart', 'https://evil.example');
  expect(evil.status).toBe(403);
  expect(evil.body).toContain('Cross-site');
});
