import { describe, expect, it } from 'vitest';
import { classify, CLARIFY_PHONE } from '../../apps/web/src/lib/assistantRouter';
import { isBatteryPhoneAnswer } from '../../apps/web/src/lib/goldieTurn';
import { namedProducts, productCodes } from '../../apps/web/src/lib/goldieProducts';
import { withoutNarration } from '../../apps/web/src/lib/goldieChannelText';
import { modelToolText, SYSTEM_PROMPT_VERSION } from '../../apps/web/src/lib/assistant';
import { productsToList } from '../../apps/api/src/domain/assistant/WhatsAppGoldie';
import { ANSWERS_VALID_FOR_PROMPT } from '../../apps/api/src/domain/assistant/AnswerMemory';

/** 2026-10-14 deep review: each case is a defect found in the day's own work, now pinned. */
const P07 = { name: 'GoldPlus GP-P07 20000mAh Power Bank with Digital Display, 22.5W, Built-in USB-C and Lightning Cables', url: 'u1', price_ugx: 130000, availability: 'in_stock' };
const P02A = { name: 'GoldPlus GP-P02A 20000mAh Power Bank with 4 Built-in Cables and Phone Stand', url: 'u2', price_ugx: 90000, availability: 'in_stock' };
const W3 = { name: 'GoldPlus GP-W3 (PD-W3) Power Bank', url: 'u3', price_ugx: 120000, availability: 'in_stock' };

describe('products are named by their model code, not by shared words', () => {
  it('codes skip measurements and USB-C', () => {
    expect(productCodes(P07.name)).toEqual(['gpp07', 'p07']);
    expect(productCodes(W3.name)).toEqual(['gpw3', 'w3', 'pdw3']);
  });
  it('recommending the GP-P02A lists only the GP-P02A (not the GP-P07, which shares "20000mAh power bank")', () => {
    const text = 'For two days away I recommend the GP-P02A 20000mAh power bank with built-in cables.';
    expect(namedProducts(text, [P07, P02A, W3], 3).map((p) => p.url)).toEqual(['u2']);
    expect(productsToList({ text, products: [P07, P02A, W3], route: 'ai' }).map((p) => p.url)).toEqual(['u2']);
    expect(namedProducts('The P07 or the W3 would both do.', [P07, P02A, W3], 3).map((p) => p.url)).toEqual(['u1', 'u3']);
  });
});

describe('a problem with something they have is care, not a search', () => {
  it.each([
    ['my charger has a problem', 'POLICY:ai'],
    ['there is an issue with my power bank', 'POLICY:ai'],
    ['I have a complaint about my earphones', 'POLICY:ai'],
    ['I need help with my charger', 'PRODUCT:ai'],
    ['help me find a charger for iphone 13', 'PRODUCT:ai'],
    ['Do you have a 20W charger?', 'PRODUCT'],
  ])('%s → %s', (m, want) => { const c = classify(m); expect(`${c.intent}${c.deterministic ? '' : ':ai'}`).toBe(want); });
});

describe("the answer to the battery finder's question goes back to the finder", () => {
  const turns = (reply: string) => [{ role: 'user' as const, content: 'tecno spark 10 battery' }, { role: 'assistant' as const, content: `${CLARIFY_PHONE} Spark 10, Spark 10 Pro, Spark 10C.` }, { role: 'user' as const, content: reply }];
  it('"Spark 10 Pro" yes; a question or "not sure" no', () => {
    expect(isBatteryPhoneAnswer(turns('Spark 10 Pro'), classify('Spark 10 Pro'))).toBe(true);
    expect(isBatteryPhoneAnswer(turns('how do I check?'), classify('how do I check?'))).toBe(false);
    expect(isBatteryPhoneAnswer(turns('not sure'), classify('not sure'))).toBe(false);
  });
});

describe('WhatsApp keeps the answer, drops only the narration', () => {
  it.each([
    ["You're right to check. I'll pull the power banks in stock again before I say anything more.", "You're right to check."],
    ['Let me check.', ''],
    ['Your order GP-202610-ABCD1234 is on its way with the rider. I will ask the team to call you as well.', 'Your order GP-202610-ABCD1234 is on its way with the rider. I will ask the team to call you as well.'],
    ["I'll ask the team to look into it.", "I'll ask the team to look into it."],
    ['It is UGX 22.5 thousand. Let me just check the stock.', 'It is UGX 22.5 thousand.'],
  ])('%s', (raw, kept) => expect(withoutNarration(raw)).toBe(kept));
});

describe('a long product list is never cut mid-line', () => {
  it('fits whole lines and says how many were left out', () => {
    const products = Array.from({ length: 40 }, (_, i) => ({ name: `GoldPlus GP-M${i} USB-C Cable, 2 m, braided`, url: `https://shopgoldplus.com/products/gp-m${i}`, price_ugx: 15000, availability: 'in_stock', sku: `GP-M${i}`, id: `0f3a9c1e-5b7d-4e2a-9c6f-1a2b3c4d5e${String(i).padStart(2, '0')}`, specifications: { Connector: 'USB-A to USB-C', Length: '2 m', 'Max output': '3 A', Material: 'Braided, copper core', 'Works with': 'All phones with USB-C' } }));
    const t = modelToolText('search_products', { structuredContent: { products } } as never)!;
    expect(t.length).toBeLessThanOrEqual(8000);
    expect(t).toMatch(/\(\d+ more matched but are not shown/);
    const lines = t.split('\n').slice(0, -1);
    for (const l of lines) expect(l).toMatch(/\| specs: /);
  });
});

it('a prompt change cannot ship without deciding about remembered answers', () => {
  expect(ANSWERS_VALID_FOR_PROMPT).toBe(SYSTEM_PROMPT_VERSION);
});
