import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { renderTemplate } from '../../apps/api/src/infrastructure/notifications/email/renderEmailTemplate';
import { GENERATED_EMAIL_TEMPLATES } from '../../apps/api/src/infrastructure/notifications/email/generatedEmailTemplates';

const SAMPLES = join(__dirname, '../../apps/api/templates/email/sample-data');

describe('the Mustache subset the templates use', () => {
  it('fills variables and escapes HTML in them', () => {
    expect(renderTemplate('Hi {{name}}', { name: 'Aisha & Co <b>' }))
      .toBe('Hi Aisha &amp; Co &lt;b&gt;');
  });

  it('leaves plain text unescaped when asked', () => {
    expect(renderTemplate('Hi {{name}}', { name: 'Aisha & Co' }, { escape: false })).toBe('Hi Aisha & Co');
  });

  it('shows a section when the value is there and hides it when it is not', () => {
    expect(renderTemplate('{{#paid}}PAID{{/paid}}', { paid: true })).toBe('PAID');
    expect(renderTemplate('{{#paid}}PAID{{/paid}}', { paid: false })).toBe('');
    expect(renderTemplate('{{^paid}}NOT YET{{/paid}}', { paid: false })).toBe('NOT YET');
    expect(renderTemplate('{{^paid}}NOT YET{{/paid}}', { paid: true })).toBe('');
  });

  it('repeats a loop over each item, in order', () => {
    expect(renderTemplate('{{#items}}[{{name}} x{{qty}}]{{/items}}', {
      items: [{ name: 'Cable', qty: 2 }, { name: 'Charger', qty: 1 }],
    })).toBe('[Cable x2][Charger x1]');
    expect(renderTemplate('{{#items}}x{{/items}}', { items: [] })).toBe('');
  });

  it('refuses to render a hole rather than emailing one', () => {
    // "Your payment of  is confirmed" must never reach a customer.
    expect(() => renderTemplate('Your payment of {{amount}} is confirmed', {}))
      .toThrow(/TEMPLATE_MISSING_VALUES: amount/);
  });

  it('refuses a section that was never closed', () => {
    expect(() => renderTemplate('{{#items}}oops', { items: [1] })).toThrow(/TEMPLATE_UNCLOSED_SECTION/);
  });
});

describe('every shipped template', () => {
  const keys = Object.keys(GENERATED_EMAIL_TEMPLATES);

  it('carries all 15, with a subject and a plain-text alternative', () => {
    expect(keys).toHaveLength(15);
    for (const key of keys) {
      const t = GENERATED_EMAIL_TEMPLATES[key];
      expect(t.subject.length, key).toBeGreaterThan(5);
      expect(t.html, key).toContain('<html');
      expect(t.text.length, key).toBeGreaterThan(40);
    }
  });

  it('renders completely against its own sample data, leaving no {{ }} behind', () => {
    const samples = readdirSync(SAMPLES).filter((f) => f.endsWith('.json'));
    expect(samples.length).toBe(15);
    for (const file of samples) {
      const data = JSON.parse(readFileSync(join(SAMPLES, file), 'utf8'));
      const key = Object.values(GENERATED_EMAIL_TEMPLATES)
        .find((t) => file.includes(t.key))?.key;
      expect(key, `no template matches sample ${file}`).toBeTruthy();
      const t = GENERATED_EMAIL_TEMPLATES[key as string];
      const html = renderTemplate(t.html, data);
      const text = renderTemplate(t.text, data, { escape: false });
      expect(html, key).not.toMatch(/\{\{/);
      expect(text, key).not.toMatch(/\{\{/);
      expect(renderTemplate(t.subject, data), key).not.toMatch(/\{\{/);
    }
  });

  it('states one consistent total: the items add up to the subtotal', () => {
    const data = JSON.parse(readFileSync(join(SAMPLES, 'customer-ORDER_PAYMENT_SUCCESS.json'), 'utf8'));
    const ugx = (s: string) => Number(String(s).replace(/[^0-9]/g, ''));
    const lines = (data.items as Array<{ line_total: string }>).reduce((sum, i) => sum + ugx(i.line_total), 0);
    expect(lines).toBe(ugx(data.subtotal));
    expect(ugx(data.subtotal) + ugx(data.delivery_fee)).toBe(ugx(data.total));
  });
});

import { adminEmailData, renderEmailTemplate } from '../../apps/api/src/infrastructure/notifications/email/emailTemplateData';

/**
 * The admin order email is the one email this shop actually sends today, and
 * the only one a member of staff acts on. It must render from the REVIEWED
 * design with real order shapes — not just with the sample file.
 */
describe('the admin order email, from real order data', () => {
  const source = {
    orderNumber: 'GP-202609-0B3BA402',
    createdAt: new Date('2026-09-20T08:20:00Z'),
    eventLabel: 'Payment confirmed',
    preparationState: 'ready for preparation',
    preparationInstruction: 'Pick, pack and prepare this order for delivery.',
    paymentStatus: 'paid',
    stockConfirmed: true,
    totalUgx: 153000,
    deliveryFeeUgx: 5000,
    customerName: 'Aisha Nakato',
    customerContactMasked: '+256 77* *** 545',
    deliveryLocation: 'Kansanga, Kampala',
    deliveryAddress: 'Plot 12, Ggaba Road',
    adminUrl: 'https://shopgoldplus.com/admin/orders/x',
    items: [
      { sku: 'GP-P07', name: 'Power Bank', quantity: 1, unitPriceUgx: 130000, lineTotalUgx: 130000 },
      { sku: 'GP-L03', name: 'USB-C Cable', quantity: 2, unitPriceUgx: 4000, lineTotalUgx: 8000 },
      { sku: 'GP-C08', name: '12W Charger', quantity: 1, unitPriceUgx: 10000, lineTotalUgx: 10000 },
    ],
  };

  it('renders with no holes, and names the order in the subject', () => {
    const out = renderEmailTemplate('ADMIN_ORDER_EMAIL', adminEmailData(source));
    expect(out.html).not.toMatch(/\{\{/);
    expect(out.subject).toContain('GP-202609-0B3BA402');
    expect(out.subject).toContain('Payment confirmed');
  });

  it('adds the lines up itself rather than trusting a passed total', () => {
    const data = adminEmailData(source);
    expect(data.subtotal).toBe('UGX 148,000');
    expect(data.total).toBe('UGX 153,000');
    expect(data.total_confirmed).toBe(true);
  });

  it('does not quote a settled total when no delivery fee has been agreed', () => {
    const data = adminEmailData({ ...source, deliveryFeeUgx: 0 });
    expect(data.total_confirmed).toBe(false);
  });

  it('shows every line item to the person who must pick them', () => {
    const out = renderEmailTemplate('ADMIN_ORDER_EMAIL', adminEmailData(source));
    for (const item of source.items) expect(out.html).toContain(item.name);
    expect(out.html).toContain('GP-P07');
  });

  it('carries the masked contact, never the raw phone', () => {
    const out = renderEmailTemplate('ADMIN_ORDER_EMAIL', adminEmailData(source));
    expect(out.html).toContain('*** 545');
    expect(out.html).not.toContain('+256776004545');
  });
});
