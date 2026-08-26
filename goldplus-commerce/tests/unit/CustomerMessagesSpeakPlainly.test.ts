import { describe, expect, it } from 'vitest';

import {
  smsText,
  whatsappText,
  emailCopy,
  CUSTOMER_TRANSACTIONAL_TEMPLATES,
  type CustomerTemplate,
} from '../../apps/api/src/application/notifications/CustomerMessages';
import { NotificationTemplateRenderer } from '../../apps/api/src/application/use-cases/notifications/NotificationTemplateRenderer';
import { classifyMessage } from '../../apps/api/src/infrastructure/notifications/messageClassification';

/**
 * Every message a customer can receive, checked as a customer would read it.
 *
 * Found in review: a loyalty SMS carried no body, so the adapter would have
 * sent "LOYALTY_EXPIRY_WARNING" as the text; the password reset email fell
 * into the operations dump ("A system event regarding password_reset
 * occurred" with the link as a key:value row); WhatsApp said "logistics
 * coordinates are actively being routed" and "Delivered and Settled".
 */

const TEMPLATES: CustomerTemplate[] = [
  'ORDER_RECEIVED_UNPAID', 'ORDER_PAYMENT_PENDING', 'ORDER_PAYMENT_SUCCESS', 'ORDER_PAYMENT_FAILED',
  'ORDER_PAYMENT_CANCELLED', 'ORDER_FULFILLMENT_PROCESSING', 'ORDER_DISPATCHED', 'ORDER_FULFILLMENT_COMPLETED',
  'ORDER_CANCELLED_BY_SHOP', 'PHONE_VERIFICATION', 'PASSWORD_RESET', 'LOYALTY_POINTS_EARNED',
  'LOYALTY_EXPIRY_WARNING', 'LOYALTY_REDEMPTION_CONFIRMED', 'LOYALTY_REDEMPTION_REVERSED', 'LOYALTY_TIER_CHANGED',
  'SUPPORT_REQUEST_RECEIVED', 'QUOTE_REQUEST_RECEIVED', 'DEALER_APPLICATION_RECEIVED', 'FAKE_REPORT_RECEIVED',
];

const DATA = {
  customerName: 'Amina Nakato', orderNumber: 'GP-202608-3F7A', totalUgx: 166500, reference: 'T-1234',
  code: '482913', resetUrl: 'https://www.shopgoldplus.com/reset-password?token=abc', expiresInMinutes: 60,
  points: 1250, pointsExpiring: 400, expiresAt: '2026-12-01T00:00:00Z', tierName: 'Gold', valueUgx: 12500,
};

/** Words that describe the system rather than help the customer. */
const SYSTEM_WORDS = /fulfil?lment stage|logistics|settled|verification required|transaction update|status has been updated|N\/A|SKU|enum|_/i;

describe('every customer message exists on every channel it should', () => {
  for (const t of TEMPLATES) {
    it(`${t}: has an SMS form`, () => {
      expect(smsText(t, DATA), t).toBeTruthy();
    });
  }

  it('the email form exists for everything except a phone code', () => {
    for (const t of TEMPLATES) {
      if (t === 'PHONE_VERIFICATION') expect(emailCopy(t, DATA)).toBeNull();
      else expect(emailCopy(t, DATA), t).toBeTruthy();
    }
  });

  it('an unknown template gets NO text, so an adapter cannot send its name', () => {
    expect(smsText('LOYALTY_SOMETHING_NEW', DATA)).toBeNull();
    expect(whatsappText('LOYALTY_SOMETHING_NEW', DATA)).toBeNull();
  });
});

describe('the words themselves', () => {
  it('fit an SMS: two segments at most, and a person to call or a link to open', () => {
    for (const t of TEMPLATES) {
      const s = smsText(t, DATA)!;
      expect(s.length, `${t} is ${s.length} chars`).toBeLessThanOrEqual(320);
      if (t !== 'PHONE_VERIFICATION') expect(s, t).toMatch(/0705 004545|https:\/\//);
    }
  });

  it('use no dashes and no system vocabulary', () => {
    for (const t of TEMPLATES) {
      const all = [smsText(t, DATA), whatsappText(t, DATA), ...Object.values(emailCopy(t, DATA) ?? {})].filter((v) => typeof v === 'string').join(' ');
      expect(all, t).not.toMatch(/[—–]| - /);
      expect(all, t).not.toMatch(SYSTEM_WORDS);
      expect(all, t).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
    }
  });

  it('never claims money was not charged on a failure, and tells a pending payer not to pay twice', () => {
    expect(smsText('ORDER_PAYMENT_FAILED', DATA)).not.toMatch(/not been charged|no funds/i);
    expect(smsText('ORDER_PAYMENT_FAILED', DATA)).toMatch(/come back/);
    expect(smsText('ORDER_PAYMENT_PENDING', DATA)).toMatch(/do not pay again/i);
    expect(emailCopy('ORDER_PAYMENT_PENDING', DATA)!.body).toMatch(/do not pay again/i);
  });

  it('never promises a time we have not committed to', () => {
    for (const t of TEMPLATES) {
      const all = [smsText(t, DATA), ...Object.values(emailCopy(t, DATA) ?? {})].filter((v) => typeof v === 'string').join(' ');
      expect(all, t).not.toMatch(/within 24 hours|same day|by tomorrow|immediately/i);
    }
  });

  it('a phone code warns against sharing it, and has no email form', () => {
    expect(smsText('PHONE_VERIFICATION', DATA)).toMatch(/Never share/);
    expect(smsText('PHONE_VERIFICATION', { ...DATA, code: null })).toBeNull();
  });

  it('the tracking link uses the parameter the tracking page reads', () => {
    expect(smsText('ORDER_PAYMENT_SUCCESS', DATA)).toContain('/track-order?reference=GP-202608-3F7A');
  });

  it('WhatsApp carries the same substance as the SMS', () => {
    for (const t of TEMPLATES) {
      const sms = smsText(t, DATA)!.replace(/^GoldPlus: /, '');
      expect(whatsappText(t, DATA), t).toContain(sms);
    }
  });
});

describe('the renderer and the gates agree with the wording table', () => {
  const renderer = new NotificationTemplateRenderer();
  const order = {
    orderNumber: 'GP-202608-3F7A', customerName: 'Amina Nakato', customerEmail: 'a@example.com', customerPhone: '+256700000000',
    orderStatus: 'processing', paymentStatus: 'paid', totalUgx: 166500, deliveryArea: 'Ntinda', createdAt: '2026-08-26T08:00:00Z',
    items: [{ productName: 'Fast Charger', quantity: 1, unitPrice: 166500 }],
  };

  it('email, text and WhatsApp receipts print no enum, no SKU, no N/A, no dashes', () => {
    for (const t of ['ORDER_PAYMENT_SUCCESS', 'ORDER_PAYMENT_FAILED', 'ORDER_RECEIVED_UNPAID', 'ORDER_FULFILLMENT_COMPLETED'] as const) {
      const html = renderer.renderEmail(t, order);
      const text = renderer.renderTextBody(t, order);
      for (const out of [html, text]) {
        expect(out, t).not.toMatch(/N\/A|SKU|Grand Total|Fulfillment|fulfillment stage|PROCESSING|pending_payment/);
        expect(out, t).not.toMatch(/[—–]/);
      }
      expect(text, t).toContain('Track this order: https://www.shopgoldplus.com/track-order?reference=GP-202608-3F7A');
    }
    const wa = renderer.renderWhatsApp(order);
    expect(wa).not.toMatch(/logistics|Settled|Excellent news|\*[A-Za-z ]+\*|status has been updated/);
    expect(wa).toContain('GP-202608-3F7A');
  });

  it('a customer email that is not a receipt renders with its own words, never the operations dump', () => {
    const copy = emailCopy('PASSWORD_RESET', DATA)!;
    const html = renderer.renderCustomerEmail(copy, 'Amina');
    expect(html).toContain('Set a new password');
    expect(html).toContain(DATA.resetUrl);
    expect(html).not.toMatch(/System Operations Alert|resetUrl|A system event/);
  });

  it('every customer template is classed transactional, so consent to marketing is never demanded for it', () => {
    for (const t of CUSTOMER_TRANSACTIONAL_TEMPLATES) {
      expect(classifyMessage({ template: t, recipient: 'x', data: {} } as never), t).toBe('TRANSACTIONAL');
    }
    for (const t of ['SUPPORT_REQUEST_RECEIVED', 'QUOTE_REQUEST_RECEIVED', 'DEALER_APPLICATION_RECEIVED', 'FAKE_REPORT_RECEIVED', 'CUSTOMER_ORDER_MESSAGE']) {
      expect(classifyMessage({ template: t, recipient: 'x', data: {} } as never), t).toBe('TRANSACTIONAL');
    }
  });
});
