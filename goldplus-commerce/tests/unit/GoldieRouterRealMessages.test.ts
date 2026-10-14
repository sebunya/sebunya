import { describe, expect, it } from 'vitest';
import { classify } from '../../apps/web/src/lib/assistantRouter';
import { clarifyFirst } from '../../apps/web/src/lib/goldieEmpathy';

/**
 * Real customer phrasings, and where each must go. 2026-10-14: "I want support" on WhatsApp was searched as a
 * product ("I don't see 'support' on our shelf"), because any "I want / I need / any" meant a product lookup.
 */
const route = (m: string) => { const c = classify(m); return `${c.intent}${c.deterministic ? '' : ':ai'}`; };

describe('help and people are never product searches', () => {
  it.each([
    ['I want support', 'UNKNOWN:ai'],
    ['I need help', 'UNKNOWN:ai'],
    ['Hi, I need assistance please', 'UNKNOWN:ai'],
    ['I have a complaint', 'UNKNOWN:ai'],
    ['any update?', 'PRODUCT:ai'],
    ['I want to talk to someone', 'CALLBACK'],
    ['Can I speak to a person', 'CALLBACK'],
    ['customer care', 'CALLBACK'],
    ['I need a real person', 'CALLBACK'],
  ])('%s → %s', (m, want) => expect(route(m)).toBe(want));

  it('a bare request for help or support gets one clarifying question (free), not a search', () => {
    for (const m of ['I want support', 'support', 'help me', 'hello, I need help', 'can you help me', 'I need assistance please']) {
      expect(clarifyFirst(m, classify(m).intent), m).toMatch(/^Of course\./);
    }
  });
});

describe('real shopping questions still get the fast catalogue answer', () => {
  it.each([
    ['Do you have a 20W charger?', 'PRODUCT'],
    ['How much is the oraimo power bank', 'PRODUCT'],
    ['I want a type c cable', 'PRODUCT'],
    ['I need earphones', 'PRODUCT'],
    ['Tecno Spark 10 battery', 'BATTERY'],
    ['do you sell tripods', 'PRODUCT'],
    ['which charger is best for iphone 13', 'PRODUCT:ai'],
    ['I want something for my car', 'PRODUCT:ai'],
    ['where is my order', 'ORDER'],
    ['I need help with my order', 'ORDER'],
    ['my charger stopped working', 'POLICY'],
    ['My power bank is not charging', 'POLICY'],
    ['my earphones are spoilt', 'POLICY'],
    ['Do you have original iphone chargers', 'PRODUCT'],
    ['is this product genuine', 'POLICY'],
    ['I ordered yesterday where is it', 'ORDER'],
    ['I paid for a cable and it has not come', 'ORDER'],
    ['I need help choosing a power bank', 'PRODUCT:ai'],
    ['I want earbuds under 50k', 'PRODUCT:ai'],
    ['Mwebale', 'GREETING'],
    ['give me your number', 'STORE'],
    ['What do you sell', 'UNKNOWN:ai'],
    ['send me your catalogue', 'UNKNOWN:ai'],
  ])('%s → %s', (m, want) => expect(route(m)).toBe(want));
});

describe('the search sees the product, not the filler', () => {
  it('Luganda "I want" and "for my phone" are dropped; a bare product asks which phone first', () => {
    expect(classify('Nkwagala charger').query).toBe('charger');
    expect(clarifyFirst('I need a charger for my phone', 'PRODUCT')).toMatch(/Which phone or device is it for\?/);
    expect(clarifyFirst('Nkwagala charger', 'PRODUCT')).toMatch(/Which phone or device is it for\?/);
  });
});
