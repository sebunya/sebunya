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
    expect(track).toMatch(/rememberedContact\(readGuestMemory\(Astro\.cookies, Astro\.request\)\)/);
  });

  it('guest memory is site-wide and httpOnly; reading prefers it over an old /checkout copy', async () => {
    expect(memory).toMatch(/path: '\/', maxAge: GUEST_MEMORY_MAX_AGE, httpOnly: true/);
    const { readGuestMemory, forgetGuestMemoryHeaders } = await import('../../apps/web/src/lib/guestMemory');
    const enc = (o: object) => encodeURIComponent(JSON.stringify(o));
    const req = new Request('https://shopgoldplus.com/checkout', { headers: { cookie: `gp_checkout_prefill=${enc({ phone: '0700000001' })}; gp_checkout_prefill=${enc({ phone: '0700000002' })}` } });
    const cookies = { get: () => ({ value: enc({ phone: '0700000001' }) }) } as never;
    expect(readGuestMemory(cookies, req).phone).toBe('0700000002');
    // "Not you?" clears both copies, as two separate Set-Cookie headers (Astro keeps one change per name).
    expect(forgetGuestMemoryHeaders()).toEqual([expect.stringContaining('Path=/;'), expect.stringContaining('Path=/checkout;')]);
  });

  it('every pre-filled form offers "Not you? Clear these details"', () => {
    for (const src of [dealer, quote, track, read('apps/web/src/pages/review.astro'), read('apps/web/src/pages/checkout.astro')]) expect(src).toMatch(/<RememberedDetails show=/);
  });
});
