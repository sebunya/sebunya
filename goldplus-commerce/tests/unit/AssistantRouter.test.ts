import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Deterministic-first routing (mandate §3, §7): the questions a shop answers
 * the same way every time never reach the model, and the answers come from
 * the same sources the pages render. Interpretive questions are marked for
 * the model. Shop tools are stubbed; the router's own logic is under test.
 */
const callTool = vi.fn();
vi.mock('../../apps/web/src/lib/agentTools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/src/lib/agentTools')>();
  return { ...actual, callTool: (...a: unknown[]) => callTool(...a) };
});
vi.mock('../../apps/web/src/lib/api', () => ({ apiBase: 'http://api.test' }));
vi.mock('../../apps/web/src/lib/businessInfo', () => ({ getBusinessInfo: async () => ({ whatsappUrl: 'https://wa.me/256705004545', mapUrl: 'https://maps.google.com/?cid=1', deliveryNote: 'Same-day in Kampala & Wakiso.' }) }));
vi.mock('../../apps/web/src/lib/storefrontCopy', () => ({ getStorefrontCopy: async () => ({ payment: { pesapal: { label: 'Pay now with Mobile Money or card', description: 'MTN or Airtel Mobile Money, or a Visa or Mastercard, through PesaPal.' }, offline: { label: 'Pay on confirmation', description: 'We call to confirm, then you pay.' } } }) }));
vi.mock('../../apps/web/src/lib/catalogue', () => ({ fetchApprovedCatalogueWithStatus: async () => ({ products: [], complete: true }) }));
vi.mock('../../apps/web/src/lib/storefrontDiscount', () => ({ getStorefrontDiscount: async () => null }));

beforeEach(() => callTool.mockReset());

describe('assistant router: classification', () => {
  it('routes the mandate\'s example questions', async () => {
    const { classify } = await import('../../apps/web/src/lib/assistantRouter');
    const cases: Array<[string, string, boolean]> = [
      ['Do you have a battery for my Tecno Spark 10 Pro?', 'BATTERY', true],
      ['Is this charger right for my phone?', 'PRODUCT', false],
      ['Which power bank can charge my laptop?', 'PRODUCT', false],
      ['What is the cheapest 64GB flash drive you have today?', 'PRODUCT', true],
      ['Can I receive this in Wakiso today?', 'DELIVERY', true],
      ['How much is delivery to my location?', 'DELIVERY', true],
      ['Where is the shop and when are you open?', 'STORE', true],
      ['How do I pay with MTN Mobile Money?', 'PAYMENT', true],
      ['What is the status of my order?', 'ORDER', true],
      ['How do I check if my GoldPlus product is genuine?', 'POLICY', true],
      ['What happens if the item stops working?', 'POLICY', true],
      ['I have a problem with a payment or refund.', 'PAYMENT', true],
      ['I need 50 power banks for the office', 'BULK', false],
      ['hello', 'GREETING', true],
      ['Will this charger fast-charge my phone?', 'PRODUCT', false],
      ['battery for Infinix Hot 10', 'BATTERY', true],
      ['BL-49FT', 'BATTERY', true],
      ['How much is the GP-C11 charger?', 'PRODUCT', true],
      ['tell me a joke', 'UNKNOWN', false],
    ];
    for (const [q, intent, deterministic] of cases) {
      const c = classify(q);
      expect([q, c.intent, c.deterministic]).toEqual([q, intent, deterministic]);
    }
  });

  it('extracts the phone or battery code for the finder, and the nouns for a product search', async () => {
    const { classify } = await import('../../apps/web/src/lib/assistantRouter');
    expect(classify('Do you have a battery for my Tecno Spark 10 Pro?').query).toBe('Tecno Spark 10 Pro');
    expect(classify('battery bl 49ft please').query).toBe('BL-49FT');
    expect(classify('I need a battery').query).toBe('');
    expect(classify('How much is a 65W charger?').query).toBe('65W charger');
    expect(classify('Do you have power banks in stock?').query).toBe('power banks');
  });
});

describe('assistant router: clarification lineage', () => {
  it('a short deterministic reply to the shop\'s own "which phone?" question is the same request; anything else is new', async () => {
    const { CLARIFY_PHONE, classify, isClarificationReply } = await import('../../apps/web/src/lib/assistantRouter');
    const ask = { role: 'assistant' as const, content: `${CLARIFY_PHONE} TECNO Spark 10, TECNO Spark 10C, TECNO Spark 10 Pro. Your exact model number is in Settings under About phone.` };
    const reply = { role: 'user' as const, content: 'Spark 10 Pro battery' };
    expect(isClarificationReply([{ role: 'user', content: 'battery for tecno spark 10' }, ask, reply], classify(reply.content))).toBe(true);
    // A new unrelated intent after the question is a new request.
    const other = { role: 'user' as const, content: 'how much is a 65W charger?' };
    expect(isClarificationReply([ask, other], classify(other.content))).toBe(false);
    // The model path never qualifies, whatever the transcript says.
    const paid = { role: 'user' as const, content: 'which charger is best for it?' };
    expect(isClarificationReply([ask, paid], classify(paid.content))).toBe(false);
  });
});

describe('assistant router: deterministic answers come from shop data', () => {
  it('store, delivery and payment answers use the business info and storefront copy, never invented wording', async () => {
    const { answerDeterministically, classify } = await import('../../apps/web/src/lib/assistantRouter');
    callTool.mockResolvedValue({ content: [{ type: 'text', text: 'GoldPlus, Zainab Aziza Building, 4th Floor, Burton Street. Open Monday to Saturday.' }], structuredContent: { map: 'https://maps.google.com/?cid=1', delivery: 'Same-day in Kampala & Wakiso. Delivery runs 8:30am to 8:00pm.' } });
    const store = await answerDeterministically(classify('where is the shop?'));
    expect(store.text).toMatch(/Zainab Aziza/);
    expect(store.links.map((l) => l.label)).toEqual(['Open the map', 'Chat on WhatsApp']);
    const delivery = await answerDeterministically(classify('do you deliver to Mbarara?'));
    expect(delivery.text).toMatch(/shown at checkout before you pay and confirmed before the rider leaves/);
    expect(delivery.text).toMatch(/outside Kampala and Wakiso/);
    const pay = await answerDeterministically(classify('how do I pay with MTN?'));
    expect(pay.text).toMatch(/MTN or Airtel Mobile Money/);
    expect(pay.text).toMatch(/never ask for your PIN or OTP/);
  });

  it('orders and warranty are routed to the existing pages; nothing is approved or looked up in chat', async () => {
    const { answerDeterministically, classify } = await import('../../apps/web/src/lib/assistantRouter');
    const order = await answerDeterministically(classify('where is my order?'));
    expect(order.text).toMatch(/Track my order shows your order/);
    expect(order.links.map((l) => l.url)).toContain('https://shopgoldplus.com/track-order');
    const warranty = await answerDeterministically(classify('my earbuds stopped working'));
    expect(warranty.text).toMatch(/nothing is approved in this chat/);
    expect(warranty.links.map((l) => l.url)).toEqual(expect.arrayContaining(['https://shopgoldplus.com/warranty', 'https://shopgoldplus.com/returns']));
    const genuine = await answerDeterministically(classify('is my charger genuine?'));
    expect(genuine.links.map((l) => l.url)).toContain('https://shopgoldplus.com/verification');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('a battery question with a phone runs the finder and renders fits as cards with their labels; an ambiguous phone asks one question', async () => {
    const { answerDeterministically, classify } = await import('../../apps/web/src/lib/assistantRouter');
    callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'x' }], structuredContent: { kind: 'DEVICE', device: { label: 'TECNO Spark 7 (KF6n)' }, results: [{ name: 'GoldPlus Battery GP-49FT', slug: 'bl-49ft-battery', canonicalCode: 'GP-49FT', priceUgx: 35000, inStock: true, imageUrl: null, fitState: 'AWAITING_VERIFICATION', fitLabel: 'Listed by the supplier, not yet checked by us' }] } });
    const fit = await answerDeterministically(classify('battery for tecno spark 7'));
    expect(callTool).toHaveBeenCalledWith('find_battery', { phone_or_code: 'tecno spark 7' });
    expect(fit.products[0]).toMatchObject({ name: 'GoldPlus Battery GP-49FT', url: 'https://shopgoldplus.com/products/bl-49ft-battery', price_ugx: 35000, note: 'Listed by the supplier, not yet checked by us' });
    expect(fit.text).toMatch(/confirm the fit before you pay/);
    callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'x' }], structuredContent: { kind: 'AMBIGUOUS_DEVICE', devices: [{ label: 'TECNO Spark 10' }, { label: 'TECNO Spark 10C' }, { label: 'TECNO Spark 10 Pro' }] } });
    const ambiguous = await answerDeterministically(classify('battery for tecno spark 10'));
    expect(ambiguous.text).toMatch(/Which of these is your phone\? TECNO Spark 10, TECNO Spark 10C, TECNO Spark 10 Pro/);
    expect(ambiguous.products).toEqual([]);
    callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'x' }], structuredContent: { kind: 'SUGGESTIONS', devices: [{ label: 'TECNO Spark 3' }, { label: 'TECNO Spark 7 (KF6n)' }] } });
    const nomatch = await answerDeterministically(classify('battery for tecno spark 10'));
    expect(nomatch.text).toMatch(/do not have the tecno spark 10 on our battery list yet/);
    expect(nomatch.text).not.toMatch(/Which of these is your phone/);
    const none = await answerDeterministically(classify('I need a battery'));
    expect(none.text).toMatch(/exact model/);
  });

  it('a product lookup searches the catalogue and says so honestly when nothing matches', async () => {
    const { answerDeterministically, classify } = await import('../../apps/web/src/lib/assistantRouter');
    callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'x' }], structuredContent: { products: [{ name: 'GoldPlus 64GB Flash Disk', url: 'https://shopgoldplus.com/products/gp-64gb-f', sku: 'GP-64GB-F', price_ugx: 45000, availability: 'in_stock', images: [] }] } });
    const found = await answerDeterministically(classify('What is the cheapest 64GB flash drive you have today?'));
    expect(callTool).toHaveBeenCalledWith('search_products', { query: expect.stringMatching(/64GB flash drive/), limit: 5 });
    expect(found.products[0].sku).toBe('GP-64GB-F');
    expect(found.text).toMatch(/Today's price and stock are with each one/);
    callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'none' }], structuredContent: { products: [] } });
    const nothing = await answerDeterministically(classify('do you have a drone?'));
    // Never a dead end: it asks what the thing is for / which device, and offers the team.
    expect(nothing.text).toMatch(/couldn't find "drone" by that name\. What is it for/);
    expect(nothing.products).toEqual([]);
  });
});
