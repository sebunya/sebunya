import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The dealer, quote and tracking journeys were shortened on 2026-10-13. These pin what made
 * them long, so it does not creep back: a required field the API never needed, a pop-up,
 * a contact typed twice, and a checkout memory no other form could read.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const dealer = read('apps/web/src/pages/dealers/apply.astro');
const quote = read('apps/web/src/pages/quote-request.astro');
const track = read('apps/web/src/pages/track-order.astro');
const memory = read('apps/web/src/lib/guestMemory.ts');
const required = (src: string) => [...src.matchAll(/name="([a-zA-Z]+)"[^>]*\brequired\b/g)].map((m) => m[1]).concat([...src.matchAll(/\brequired(?:=\{true\})?\s[^>]*name="([a-zA-Z]+)"/g)].map((m) => m[1]));

describe('short form journeys', () => {
  it('dealer: TIN is optional, no terms checkbox, no pop-up, at most four required fields', () => {
    expect(dealer).not.toMatch(/errors\.tinNumber\s*=/);
    expect(dealer).not.toMatch(/name="agree"/);
    expect(dealer).not.toMatch(/\balert\(/);
    expect(new Set(required(dealer)).size).toBeLessThanOrEqual(4);
  });

  it('quote: delivery location is optional; the API rule (name, phone, product, quantity) is the page rule', () => {
    expect(quote).not.toMatch(/errors\.locationJson\s*=/);
    for (const f of ['productName', 'quantity', 'customerName', 'phone']) expect(quote).toMatch(new RegExp(`errors\\.${f}\\s*=`));
    expect(quote).toMatch(/name="organisation"/);
  });

  it('tracking: the follow-up carries the proven contact instead of asking again; texted links can open the order', () => {
    expect(track).toMatch(/<input type="hidden" name="contact" value=\{submittedContact\} \/>\s*<label class="block">\s*<span class="text-xs font-bold text-slate-700">Anything/);
    expect(track).toMatch(/rememberedContact\(readGuestMemory\(Astro\.cookies\)\)/);
  });

  it('guest memory is site-wide, httpOnly, and replaces the old /checkout-scoped copy', () => {
    expect(memory).toMatch(/path: '\/', maxAge: GUEST_MEMORY_MAX_AGE, httpOnly: true/);
    expect(memory).toMatch(/cookies\.delete\(GUEST_MEMORY_COOKIE, \{ path: '\/checkout' \}\)/);
  });
});
