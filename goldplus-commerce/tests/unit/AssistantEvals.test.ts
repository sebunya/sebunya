import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The evaluation set (docs/ai-cx/evals/questions.json, synthetic, mandate §12)
 * run through the router: every question must take the route the set says,
 * so a routing regression shows up here as a named question, not a vague
 * drop in quality. The model is never called; this pins the deterministic
 * share, which is what keeps the month inside $5.
 */
vi.mock('../../apps/web/src/lib/api', () => ({ apiBase: 'http://api.test' }));
vi.mock('../../apps/web/src/lib/businessInfo', () => ({ getBusinessInfo: async () => ({}) }));
vi.mock('../../apps/web/src/lib/storefrontCopy', () => ({ getStorefrontCopy: async () => ({}) }));
vi.mock('../../apps/web/src/lib/catalogue', () => ({ fetchApprovedCatalogueWithStatus: async () => ({ products: [], complete: true }) }));
vi.mock('../../apps/web/src/lib/storefrontDiscount', () => ({ getStorefrontDiscount: async () => null }));
import { vi } from 'vitest';

interface Q { id: number; group: string; text: string; intent: string; deterministic: boolean; note?: string }
const set = JSON.parse(readFileSync(resolve(__dirname, '../../docs/ai-cx/evals/questions.json'), 'utf8')) as { questions: Q[] };

describe('assistant evaluation set', () => {
  it('has at least 100 questions across the five groups', () => {
    expect(set.questions.length).toBeGreaterThanOrEqual(100);
    const groups = new Set(set.questions.map((q) => q.group));
    expect([...groups].sort()).toEqual(['abuse', 'failure', 'grounded', 'language', 'sensitive']);
    expect(new Set(set.questions.map((q) => q.id)).size).toBe(set.questions.length);
  });

  it('routes every question as the set says (intent and deterministic/model)', async () => {
    const { classify } = await import('../../apps/web/src/lib/assistantRouter');
    const wrong = set.questions
      .map((q) => ({ q, c: classify(q.text) }))
      .filter(({ q, c }) => c.intent !== q.intent || c.deterministic !== q.deterministic)
      .map(({ q, c }) => `#${q.id} "${q.text}" expected ${q.intent}/${q.deterministic ? 'deterministic' : 'model'} got ${c.intent}/${c.deterministic ? 'deterministic' : 'model'}`);
    expect(wrong).toEqual([]);
  });

  it('answers at least two thirds of the set without a model call', async () => {
    const { classify } = await import('../../apps/web/src/lib/assistantRouter');
    const deterministic = set.questions.filter((q) => classify(q.text).deterministic).length;
    expect(deterministic / set.questions.length).toBeGreaterThanOrEqual(2 / 3);
  });

  it('never routes an order, payment or warranty question to the model', async () => {
    const { classify } = await import('../../apps/web/src/lib/assistantRouter');
    for (const q of set.questions.filter((q) => ['ORDER', 'PAYMENT', 'POLICY'].includes(q.intent))) {
      expect(classify(q.text).deterministic, q.text).toBe(true);
    }
  });
});
