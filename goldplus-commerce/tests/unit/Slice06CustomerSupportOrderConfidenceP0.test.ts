import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const support = read('apps/web/src/pages/support/index.astro');
const orderHelp = read('apps/web/src/pages/track-order.astro');
const sliceRuntime = `${support}\n${orderHelp}`;

describe('Slice 06 customer support and order confidence P0', () => {
  it('renders clear public support and order-help surfaces', () => {
    expect(support).toContain('How can we help?');
    expect(support).toContain('Need help with an order?');
    expect(support).toContain('href="/track-order"');
    expect(orderHelp).toContain('Need help with an order?');
    expect(orderHelp).toContain('Have your order reference ready.');
    expect(orderHelp).toContain('aria-label="Information to prepare for order support"');
  });

  it('uses an honest support-first fallback instead of claiming live tracking', () => {
    expect(orderHelp).toContain('This is an order-help page, not live courier tracking.');
    expect(orderHelp).toContain('It does not confirm payment, product availability, dispatch, delivery status or an arrival time.');
    expect(orderHelp).toContain('An order reference alone is not proof that an order is paid, confirmed or dispatched.');
  });

  it('keeps WhatsApp support link-only and accessible', () => {
    expect(sliceRuntime).toContain('href={whatsappSupportUrl}');
    expect(sliceRuntime).toContain('href={orderHelpWhatsappUrl}');
    expect(sliceRuntime).toContain('target="_blank"');
    expect(sliceRuntime).toContain('rel="noopener noreferrer"');
    expect(sliceRuntime).toContain('No message is sent automatically.');
    expect(sliceRuntime).not.toMatch(/WhatsAppAdapter|sendWhatsApp|whatsapp\/send|postJson|method=["']POST/i);
  });

  it('renders returns, warranty, terms and privacy links with qualified policy copy', () => {
    for (const label of ['Returns help', 'Warranty help', 'Terms guidance', 'Privacy guidance']) {
      expect(sliceRuntime).toContain(label);
    }
    expect(sliceRuntime).toContain('Warranty and returns are subject to the applicable GoldPlus policy');
    expect(orderHelp).toContain('href="/support#terms-guidance"');
    expect(orderHelp).not.toMatch(/href=["']\/(?:terms|privacy)["']/);
    expect(sliceRuntime).not.toMatch(/free returns|money-back guarantee|replacement guarantee|\d+[- ](?:day|month|year) warranty/i);
  });

  it('introduces no courier timeline, ETA, paid, confirmed or dispatch claims', () => {
    expect(sliceRuntime).not.toMatch(/Delivery status progress|Order Received|In Processing|Completed \/ Delivered|guaranteed delivery|arrives? (?:today|tomorrow|in)|payment confirmed|your order is dispatched/i);
  });

  it('introduces no API lookup, provider send, auth or measurement behavior', () => {
    expect(sliceRuntime).not.toMatch(/apiBase|ApiEnvelope|fetch\(|postJson|\/commerce\/orders\/lookup|telemetry|measurement|auth|PesaPal/i);
  });

  it('keeps support actions keyboard-visible and mobile-friendly', () => {
    expect(sliceRuntime).toContain('focus-visible:ring-2');
    expect(sliceRuntime).toContain('min-h-11');
    expect(sliceRuntime).toContain('sm:flex-row');
    expect(sliceRuntime).toContain('aria-label="Customer policy help"');
    expect(sliceRuntime).toContain('aria-label="Order policy help"');
  });
});
