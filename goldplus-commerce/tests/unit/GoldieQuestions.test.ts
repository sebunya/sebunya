import { describe, expect, it } from 'vitest';
import { classify } from '../../apps/web/src/lib/assistantRouter';
import { deliveryQuestion, pageQuestions, productQuestions, shortProductName, todayStillOpen, type PageKey } from '../../apps/web/src/lib/goldieQuestions';

// Real catalogue names, one or two per kind (2026-10-13).
const NAMES = [
  'GoldPlus Replacement Battery GP-39LT9 — fits the Spark 4 and the A56',
  'GoldPlus Battery GP-10BI',
  'GoldPlus GP-P06 10000mAh Compact Power Bank, 22.5W, Built-in USB-C and Lightning Cables',
  'GoldPlus GP-X03 Power Bank with Carry Handle',
  'GoldPlus GP-C11 Wall Charger (UK plug)',
  'GoldPlus GP-L06C USB-C Charging Cable',
  'GoldPlus GP01 Wireless Earbuds',
  'GoldPlus 1GB Memory Card (microSD)',
  'GoldPlus ADT-S005 USB Sound Card',
];
const PAGES: PageKey[] = ['batteries', 'chargers', 'power-banks', 'cables', 'audio', 'storage', 'delivery', 'guide', 'home'];

describe('Goldie chip questions', () => {
  it('shortens product names to what a shopper would say', () => {
    expect(shortProductName(NAMES[0])).toBe('Replacement Battery GP-39LT9');
    expect(shortProductName(NAMES[2])).toBe('GP-P06 10000mAh Compact Power Bank');
    expect(shortProductName(NAMES[7])).toBe('1GB Memory Card');
  });

  it('every ask names its subject and none is left for the model to guess (never UNKNOWN)', () => {
    for (const phone of ['', 'Samsung Galaxy A12']) for (const todayOpen of [true, false]) {
      for (const name of NAMES) for (const q of productQuestions({ name, isBattery: false, phone, todayOpen })) {
        expect(classify(q.ask).intent, q.ask).not.toBe('UNKNOWN');
        // The ask must stand on its own: the server never sees the page it came from.
        expect(q.ask, q.ask).not.toMatch(/\b(will it|does it|is it good|this one)\b/i);
      }
      for (const key of PAGES) for (const q of pageQuestions(key, phone, todayOpen)) expect(classify(q.ask).intent, q.ask).not.toBe('UNKNOWN');
    }
  });

  it('fit and delivery questions are answered from shop data with no model call', () => {
    const fit = productQuestions({ name: NAMES[0], isBattery: true, phone: 'Samsung Galaxy A12', todayOpen: true })[0];
    expect(fit.ask).toBe('Will the Replacement Battery GP-39LT9 fit my Samsung Galaxy A12?');
    expect(classify(fit.ask)).toMatchObject({ intent: 'BATTERY', deterministic: true, query: 'Samsung Galaxy A12' });
    // No phone known: the battery route asks for it (free), instead of the model guessing.
    expect(classify(productQuestions({ name: NAMES[1], isBattery: true, phone: '', todayOpen: true })[0].ask)).toMatchObject({ intent: 'BATTERY', deterministic: true });
    for (const todayOpen of [true, false]) {
      const d = productQuestions({ name: NAMES[4], isBattery: false, phone: '', todayOpen })[1];
      expect(classify(d.ask)).toMatchObject({ intent: 'DELIVERY', deterministic: true });
      expect(classify(deliveryQuestion(todayOpen).ask)).toMatchObject({ intent: 'DELIVERY', deterministic: true });
    }
  });

  it('power banks named with built-in cables get the power bank question, not the cable one', () => {
    expect(productQuestions({ name: NAMES[2], isBattery: false, phone: '', todayOpen: true })[0].label).toBe('How many charges will I get?');
  });

  it('never repeats the product kind ("the Earbuds earphones")', () => {
    const all = NAMES.flatMap((name) => productQuestions({ name, isBattery: false, phone: '', todayOpen: true }).map((q) => q.ask));
    for (const a of all) expect(a, a).not.toMatch(/\b(battery battery|power bank power bank|memory card memory card|earbuds earphones)\b/i);
  });

  it('says "today" only while today is possible (shop cutoff, Kampala time)', () => {
    expect(todayStillOpen(17, new Date('2026-10-13T13:59:00Z'))).toBe(true);  // 16:59 Kampala
    expect(todayStillOpen(17, new Date('2026-10-13T14:00:00Z'))).toBe(false); // 17:00 Kampala
    expect(deliveryQuestion(false).label).toBe('When can it reach me?');
  });
});

describe('"replacement battery" is a product, not a return', () => {
  // Every battery is listed as "Replacement Battery ..." and shoppers search with the same words.
  // The returns rule used to match "replacement", so the shop's core search got the returns policy.
  it.each([
    'Do you have a replacement battery for my Tecno Spark 7?',
    'replacement battery for samsung a12',
    'How much is a replacement battery?',
    'I need a replacement battery',
  ])('%s -> BATTERY', (q) => { expect(classify(q).intent).toBe('BATTERY'); });

  it.each([
    'My battery is faulty, can I get a replacement?',
    'Can I replace a faulty charger?',
    'What is your warranty?',
  ])('%s -> still POLICY', (q) => { expect(classify(q).intent).toBe('POLICY'); });
});
