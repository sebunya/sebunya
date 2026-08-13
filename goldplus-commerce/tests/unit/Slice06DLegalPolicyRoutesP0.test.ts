import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const terms = read('apps/web/src/pages/terms.astro');
const privacy = read('apps/web/src/pages/privacy.astro');
const layout = read('apps/web/src/layouts/BaseLayout.astro');
const legalPages = `${terms}\n${privacy}`;

describe('Slice 06-D legal policy routes P0', () => {
  it('renders concise, in-force terms and privacy pages', () => {
    expect(terms).toContain('<h1 class="mt-3 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">Terms of service</h1>');
    expect(privacy).toContain('<h1 class="mt-3 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">Privacy policy</h1>');
    // 2026-08-13: the owner approved these policies for production, so they no
    // longer describe themselves as provisional. Google OAuth verification
    // requires the published privacy policy to be a definite document.
    expect(terms).toContain('These terms apply to your use of the GoldPlus website');
    expect(privacy).toContain('This policy explains what information GoldPlus handles');
    expect(legalPages).not.toMatch(/interim|pending legal review|to be confirmed/i);
  });

  it('links both pages back to support and to each other', () => {
    expect(terms).toContain('href="/support"');
    expect(terms).toContain('href="/privacy"');
    expect(privacy).toContain('href="/support"');
    expect(privacy).toContain('href="/terms"');
  });

  it('repairs the destinations already linked by the existing footer', () => {
    expect(layout).toContain('href="/privacy"');
    expect(layout).toContain('href="/terms"');
  });

  it('qualifies order, delivery, returns and warranty guidance honestly', () => {
    expect(terms).toContain('An order reference helps identify a request, but it is not by itself proof that an order is paid, confirmed or dispatched.');
    expect(terms).toContain('Delivery timing, cost and support depend on your location, product availability and order details.');
    expect(terms).toContain('Warranty, returns and replacements depend on the product, order details and applicable GoldPlus policy.');
  });

  it('describes data use without unsupported blanket promises', () => {
    expect(privacy).toContain('We use order and contact details to process purchases, provide support and improve the service.');
    expect(privacy).toContain('No online service can promise absolute security.');
    expect(privacy).not.toMatch(/we (?:never|do not) (?:collect|share|retain|use) any data|we never share/i);
  });

  it('introduces no invented legal, warranty, return, replacement or delivery guarantee', () => {
    expect(legalPages).not.toMatch(/lawyer[- ]approved|guaranteed free returns|free returns|money-back guarantee|replacement guarantee|same-day delivery guarantee|\d+[- ](?:day|month|year) warranty/i);
  });

  it('is web-only, accessible and free of provider or mutation behavior', () => {
    expect(legalPages).toContain('aria-label="Terms sections"');
    expect(legalPages).toContain('aria-label="Privacy sections"');
    expect(legalPages).toContain('focus-visible:ring-2');
    expect(legalPages).toContain('sm:flex-row');
    // The bare word `auth` was matching the PROSE word "Authorisation" in the
    // privacy policy's Google-data section — a false positive against a guard
    // whose intent is "no provider/mutation CODE on a public legal page".
    // Narrowed to the actual code constructs; the intent is unchanged.
    expect(legalPages).not.toMatch(/fetch\(|postJson|apiBase|PesaPal|WhatsAppAdapter|sendWhatsApp|measurement|telemetry|authMiddleware|readSessionToken|Authorization:|method=["']POST/i);
  });
});
