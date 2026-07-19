import { describe, it, expect } from 'vitest';
import {
  buildAdminEmailIdempotencyKey,
  deriveAdminPreparationState,
  parseAdminRecipients,
  maskAdminEmail,
  renderAdminOrderEmail,
  escapeHtml,
  AdminOrderEmailInput,
} from '../../apps/api/src/domain/notifications/AdminOrderEmail';

describe('Admin order email — idempotency keys', () => {
  it('builds the exact contract keys', () => {
    expect(buildAdminEmailIdempotencyKey('o1', 'placed')).toBe('order:o1:admin-email:placed');
    expect(buildAdminEmailIdempotencyKey('o1', 'payment-confirmed')).toBe('order:o1:admin-email:payment-confirmed');
    expect(buildAdminEmailIdempotencyKey('o1', 'cancelled')).toBe('order:o1:admin-email:cancelled');
  });
});

describe('Admin preparation state (payment never clears stock hold)', () => {
  it('READY only when payment AND stock are confirmed', () => {
    expect(deriveAdminPreparationState({ event: 'payment-confirmed', paymentConfirmed: true, stockConfirmed: true })).toBe('READY_FOR_PREPARATION');
  });
  it('payment confirmed but stock held → ON_HOLD_STOCK (hold not cleared by payment)', () => {
    expect(deriveAdminPreparationState({ event: 'payment-confirmed', paymentConfirmed: true, stockConfirmed: false })).toBe('ON_HOLD_STOCK');
  });
  it('stock confirmed but unpaid → AWAITING_PAYMENT', () => {
    expect(deriveAdminPreparationState({ event: 'placed', paymentConfirmed: false, stockConfirmed: true })).toBe('AWAITING_PAYMENT');
  });
  it('cancelled wins over everything', () => {
    expect(deriveAdminPreparationState({ event: 'cancelled', paymentConfirmed: true, stockConfirmed: true })).toBe('CANCELLED');
  });
});

describe('Admin recipients config (never hard-coded)', () => {
  it('parses, validates and dedupes', () => {
    const cfg = parseAdminRecipients('ops@goldplus.test, ops@goldplus.test; bad-email, warehouse@goldplus.test');
    expect(cfg.recipients).toEqual(['ops@goldplus.test', 'warehouse@goldplus.test']);
    expect(cfg.state).toBe('READY');
  });
  it('empty/invalid config → MISSING_CONFIG', () => {
    expect(parseAdminRecipients('').state).toBe('MISSING_CONFIG');
    expect(parseAdminRecipients('not-an-email').state).toBe('MISSING_CONFIG');
    expect(parseAdminRecipients(undefined).recipients).toEqual([]);
  });
  it('masks addresses for display', () => {
    expect(maskAdminEmail('warehouse@goldplus.test')).toBe('wa***@goldplus.test');
  });
});

describe('Admin order email rendering', () => {
  const base: AdminOrderEmailInput = {
    event: 'placed',
    orderNumber: 'GP-202607-ABCD',
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    preparationState: 'AWAITING_PAYMENT',
    paymentMethod: null,
    paymentStatus: 'unpaid',
    stockConfirmed: true,
    totalUgx: 105000,
    deliveryFeeUgx: 5000,
    customerDisplayName: 'Amina Nakato',
    customerContactMasked: '077****56',
    deliverySummary: 'Kampala · Nakawa',
    items: [
      { sku: 'SKU-1', name: 'Fast Charger 25W', quantity: 2, unitPriceUgx: 45000, lineTotalUgx: 90000 },
      { sku: 'SKU-2', name: 'USB-C Cable', quantity: 1, unitPriceUgx: 15000, lineTotalUgx: 15000 },
    ],
    adminOrderLink: 'https://shopgoldplus.com/admin/fulfilment?order=o1',
  };

  it('includes every product once in one email with correct totals', () => {
    const { text, html, subject } = renderAdminOrderEmail(base);
    expect(subject).toContain('GP-202607-ABCD');
    for (const part of ['Fast Charger 25W', 'SKU-1', 'USB-C Cable', 'SKU-2']) {
      expect(text).toContain(part);
      expect(html).toContain(part);
    }
    expect(text).toContain('UGX 105,000');
    expect(html).toContain('https://shopgoldplus.com/admin/fulfilment?order=o1');
  });

  it('escapes unsafe content (no XSS injection)', () => {
    const { html } = renderAdminOrderEmail({
      ...base,
      customerDisplayName: '<script>alert(1)</script>',
      items: [{ sku: '"><img src=x onerror=y>', name: 'A & B <b>', quantity: 1, unitPriceUgx: 1, lineTotalUgx: 1 }],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B &lt;b&gt;');
    expect(html).not.toContain('onerror=y>');
  });

  it('surfaces the do-not-prepare warning when stock unconfirmed', () => {
    const { text, html } = renderAdminOrderEmail({ ...base, stockConfirmed: false, preparationState: 'ON_HOLD_STOCK' });
    expect(text).toContain('do not prepare');
    expect(html).toContain('do not prepare');
  });

  it('escapeHtml handles all reserved characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
