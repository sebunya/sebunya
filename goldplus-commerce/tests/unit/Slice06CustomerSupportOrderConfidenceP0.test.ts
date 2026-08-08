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
    // 2026-08-08: track-order became a real order-lookup + dispatch-progress page
    // (customer request: dispatch tracking + back-office follow-up, no live GPS).
    expect(orderHelp).toContain("Where's my order?");
    expect(orderHelp).toContain('Look up your order');
    expect(orderHelp).toContain('aria-label="What you need"');
  });

  it('shows dispatch progress but never claims live courier / GPS tracking', () => {
    // Fulfilment stages (placed → preparing → dispatched → delivered), not a map.
    expect(orderHelp).toContain('aria-label="Dispatch progress"');
    for (const stage of ['Order placed', 'Confirmed & preparing', 'Dispatched', 'Delivered']) {
      expect(orderHelp).toContain(stage);
    }
    expect(orderHelp).toContain('not a live map');
    expect(orderHelp).toContain('not live courier tracking');
  });

  it('keeps WhatsApp support link-only; back-office sends only on explicit submit', () => {
    expect(sliceRuntime).toContain('href={whatsappSupportUrl}');
    expect(sliceRuntime).toContain('href={orderHelpWhatsappUrl}');
    expect(sliceRuntime).toContain('target="_blank"');
    expect(sliceRuntime).toContain('rel="noopener noreferrer"');
    // WhatsApp is a pre-filled link the customer must send themselves — never an
    // automated provider send. The follow-up ticket is raised only when the
    // customer submits the follow-up form (intent=followup), never on page load.
    expect(orderHelp).toContain('name="intent" value="lookup"');
    expect(orderHelp).toContain('name="intent" value="followup"');
    expect(sliceRuntime).not.toMatch(/WhatsAppAdapter|sendWhatsApp|whatsapp\/send/i);
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

  it('verifies order ownership before showing details, with no login or credential capture', () => {
    // The lookup only reveals an order when the reference AND the checkout contact
    // match — the privacy guarantee that replaced the old no-lookup contract.
    expect(orderHelp).toContain('Enter both your order reference and the phone number or email used at checkout.');
    expect(orderHelp).toContain('We only show order details when the reference and contact match');
    // No password, OTP or payment field is ever collected here.
    expect(orderHelp).toContain('Never share payment credentials, passwords or one-time codes.');
    expect(orderHelp).not.toMatch(/type=["']password["']|one-time code input|name=["'](?:password|otp|pin|card|cvv)["']/i);
    // Public page — no session/auth requirement, no measurement/telemetry.
    expect(sliceRuntime).not.toMatch(/readSessionToken|Authorization|Bearer |telemetry|measurement|PesaPal/i);
  });

  it('keeps support actions keyboard-visible and mobile-friendly', () => {
    expect(sliceRuntime).toContain('focus-visible:ring-2');
    expect(sliceRuntime).toContain('min-h-11');
    expect(sliceRuntime).toContain('sm:flex-row');
    expect(sliceRuntime).toContain('aria-label="Customer policy help"');
    expect(sliceRuntime).toContain('aria-label="Order policy help"');
  });
});
