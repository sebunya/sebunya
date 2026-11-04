import { describe, it, expect } from 'vitest';
import { smsText } from '../../apps/api/src/application/notifications/CustomerMessages';
import { smsSegments, tagShopLinks, tagShopLinksInSms } from '../../packages/shared/src/links/shopLinkTag';

/**
 * Every SMS we send with a shop link must arrive tagged (ch=s.<campaign>), or the tap reads as "direct" in every
 * report. tagShopLinksInSms drops the tag rather than pay for one more part, so a wording that sits just under a
 * part boundary silently loses it: ORDER_DISPATCHED did, at 156 characters (found 2026-11-04). This renders each
 * link-bearing wording with realistic, long-ish data and insists the tag survives.
 */
const data = {
  orderNumber: 'GP-10427', totalUgx: 185000, customerName: 'Aisha', points: 120, pointsExpiring: 80, expiresAt: '2026-12-01',
  tierName: 'Silver', valueUgx: 50000, creditKind: 'gift_card', creditLast4: '4821', creditCode: 'GP-7K3M-2QX9', balanceUgx: 20000,
  recipientName: 'Brian', fromName: 'Aisha', reference: 'GC-240', recipientPhoneMasked: '07•• ••• 412',
  productName: 'GoldPlus GP-C03 45W Dual-Port Fast Charger',
  questionAnswer: 'Yes, it charges a Samsung A14 from empty in about 80 minutes with the USB-C cable in the box.',
  productUrl: 'https://www.shopgoldplus.com/products/gp-c03-45w-dual-port-fast-charger',
  basketItems: 'GoldPlus GP-C03 45W Dual-Port Fast Charger and 1 more', basketUrl: 'https://www.shopgoldplus.com/cart',
  stopUrl: 'https://www.shopgoldplus.com/stop-texts?t=abcdefghijklmnopqrstuvwxyz0123456789',
  preferencesUrl: 'https://www.shopgoldplus.com/account/preferences',
  resetUrl: 'https://www.shopgoldplus.com/reset-password?token=0123456789abcdef0123456789abcdef', missionTitle: 'First review',
};
const templates = [
  'ORDER_RECEIVED_UNPAID', 'ORDER_PAYMENT_SUCCESS', 'ORDER_FULFILLMENT_PROCESSING', 'ORDER_DISPATCHED', 'ORDER_FULFILLMENT_COMPLETED', 'ORDER_COLLECTED',
  'ORDER_PAYMENT_REMINDER', 'GIFT_CARD_RECEIVED', 'GIFT_CARD_PAID', 'ORDER_REVIEW_REMINDER', 'PASSWORD_RESET', 'LOYALTY_POINTS_EARNED',
  'LOYALTY_EXPIRY_WARNING', 'LOYALTY_REDEMPTION_CONFIRMED', 'LOYALTY_REDEMPTION_REVERSED', 'LOYALTY_TIER_CHANGED',
  'PRODUCT_QUESTION_ANSWERED', 'BASKET_REMINDER',
];
const variants = [{}, { guest: true, toBuyer: true, deliverOnWords: 'Friday', direction: 'down' }];

describe('every SMS shop link keeps its channel tag', () => {
  it.each(templates)('%s', (template) => {
    let seen = 0;
    for (const variant of variants) {
      const text = smsText(template, { ...data, ...variant } as never);
      if (!text || !/shopgoldplus\.com\//.test(text)) continue;
      seen += 1;
      const tagged = tagShopLinksInSms(text);
      expect(tagged, `${template}: ${text.length} chars, ${smsSegments(text)} part(s) untagged, ${smsSegments(tagShopLinks(text, 's'))} tagged`).not.toBe(text);
      expect(tagged).toMatch(/[?&]ch=s\./);
    }
    expect(seen, `${template} rendered no shop link with this data`).toBeGreaterThan(0);
  });

  it('ORDER_DISPATCHED stays one part with its tag, with a long order number', () => {
    const text = smsText('ORDER_DISPATCHED', { ...data, orderNumber: 'GP-104271' } as never)!;
    expect(smsSegments(tagShopLinksInSms(text))).toBe(1);
  });
});
