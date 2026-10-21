import { describe, expect, it } from 'vitest';
import { deliveryMapUrl, gsmPlain, paidOrderAlertText } from '../../apps/api/src/domain/fulfilment/PaidOrderAlert';
import { DefaultNotificationRouter } from '../../apps/api/src/infrastructure/notifications/NotificationRouter';

// The order the owner flagged on 2026-10-21: a typed-in place, a foreign number, no delivery fee.
const order = {
  orderNumber: 'GP-202610-B6705CAB', totalUgx: 110_000, deliveryFeeUgx: 0,
  items: [{ name: 'GoldPlus GP-P02W 20000mAh Wireless Power Bank with 4 Built-in Cables and Camping Lamp', sku: 'GP-P02W-PB', quantity: 1 }],
  customerName: 'Mrs Susan Lutzner', customerPhone: '+4512345643',
  deliveryArea: "Deliver to (Elijah) at Moonbean Chocolate - it's his birthday ;)",
  deliveryAddress: "Deliver to (Elijah) at Moonbean Chocolate - it's his birthday ;)",
  orderUrl: 'https://shopgoldplus.com/admin/orders/1b2c',
};
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";

describe('the paid-order SMS to the shop (2026-10-21)', () => {
  it('says what to pack, where it goes once, who to call in full, that delivery was not charged, and links the order', () => {
    const t = paidOrderAlertText(order);
    expect(t.split('\n')).toEqual([
      'GoldPlus PAID GP-202610-B6705CAB UGX 110,000',
      '1x GoldPlus GP-P02W 20000mAh Wireless Power Bank... [GP-P02W-PB]',
      "Deliver: Deliver to (Elijah) at Moonbean Chocolate - it's his birthday ;)",
      'Customer: Mrs Susan Lutzner +4512345643',
      'Delivery NOT charged: agree the fee with the customer before dispatch.',
      'Open: https://shopgoldplus.com/admin/orders/1b2c',
    ]);
    expect([...t].filter((c) => !GSM.includes(c))).toEqual([]);
  });

  it('names a picked place, adds the map, folds curly quotes and emoji into plain text, and lists at most three items', () => {
    const t = paidOrderAlertText({
      ...order, deliveryFeeUgx: 6_500, placeLabel: 'Ntinda, Kampala', deliveryArea: 'Ntinda, Kampala', deliveryAddress: 'Next to Shell “blue gate” 🎁',
      mapUrl: deliveryMapUrl({ gpsLat: 0.3546, gpsLng: 32.6153 }), storeCreditUgx: 50_000,
      items: [1, 2, 3, 4].map((n) => ({ name: `Item ${n}`, sku: `S${n}`, quantity: n })),
    });
    expect(t).toContain('(gift card UGX 50,000)');
    expect(t).toContain('Deliver: Ntinda, Kampala, Next to Shell "blue gate"');
    expect(t).toContain('Map: https://maps.google.com/?q=0.354600,32.615300');
    expect(t).toContain('+1 more item(s)');
    expect(t).not.toContain('NOT charged');
    expect([...t].filter((c) => !GSM.includes(c))).toEqual([]);
  });

  it('a collection order says Collect, and never asks for a delivery fee', () => {
    const t = paidOrderAlertText({ ...order, deliveryArea: 'Pickup point: GoldPlus shop, Burton Street', deliveryAddress: 'Pickup point: GoldPlus shop, Burton Street' });
    expect(t).toContain('Collect: Pickup point: GoldPlus shop, Burton Street');
    expect(t).not.toContain('NOT charged');
  });

  it('folds only what the SMS alphabet cannot carry', () => {
    expect(gsmPlain('Kyaligonza’s “gift” – 🎂')).toBe('Kyaligonza\'s "gift" -');
    expect(deliveryMapUrl(null)).toBeNull();
    expect(deliveryMapUrl({ placeId: 'ChIJ12345abcde' })).toBe('https://www.google.com/maps/place/?q=place_id:ChIJ12345abcde');
  });

  it('the router sends the new text for a new event, and the old one-liner for an event queued before the change', async () => {
    const provider = { name: 'test', send: async () => ({ ok: true }) } as any;
    const router = new DefaultNotificationRouter(provider, provider, provider);
    const targets = await router.route('FULFILMENT_PAID_ORDER_ALERT', { recipient: '+256700000001', ...order, deliveryPlace: order.deliveryAddress, items: order.items });
    const old = await router.route('FULFILMENT_PAID_ORDER_ALERT', { recipient: '+256700000001', orderNumber: 'GP-1', totalUgx: 1000, deliveryArea: 'Ntinda' });
    const text = (t: any[]) => String((t[0]?.payload?.data as any)?.message ?? '');
    expect(text(targets)).toContain('Customer: Mrs Susan Lutzner +4512345643');
    expect(text(old)).toBe('GoldPlus: order GP-1 is PAID (UGX 1,000) for Ntinda. Prepare it for delivery.');
  });
});

describe('the fulfilment queue shows the customer’s number to the people preparing the order (2026-10-21)', () => {
  it('each task carries the full phone read from its order; none when the order has none', async () => {
    const { ListFulfilmentQueueUseCase } = await import('../../apps/api/src/application/use-cases/fulfilment/ListFulfilmentQueueUseCase');
    const task = (id: string, orderId: string) => ({ id, orderId, status: 'NEW', slaDueAt: new Date(Date.now() + 3_600_000), customerContactMasked: '+45****43' }) as any;
    const repo = { listQueue: async () => ({ tasks: [task('t1', 'o1'), task('t2', 'o2')], total: 2, customerPhones: { o1: '+4512345643' } }) } as any;
    const page = await new ListFulfilmentQueueUseCase(repo).execute({ activeOnly: true } as any);
    expect(page.tasks.map((t) => [t.id, t.customerPhone])).toEqual([['t1', '+4512345643'], ['t2', null]]);
  });
});
