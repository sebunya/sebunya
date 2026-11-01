import { describe, expect, it } from 'vitest';
import { classifyIntent, normalizeQuery } from '../../apps/api/src/application/use-cases/seo-growth/QueryIntelligence';

/**
 * Real queries Search Console reports for this shop. An UNKNOWN intent blocks
 * ownership (resolveOwnership returns INSUFFICIENT_EVIDENCE with blocker
 * INTENT_UNKNOWN), and no owner means no opportunity — so a brand query the
 * rules fail to recognise silently costs the whole chain.
 */
describe('brand demand is recognised in the forms people actually type', () => {
  for (const q of ['goldplus', 'gold plus', 'shop gold plus', 'shopgoldplus.com', 'shopgold', 'shop gold']) {
    it(`"${q}" normalises to the brand and classifies as BRAND`, () => {
      expect(normalizeQuery(q).normalized).toContain('goldplus');
      expect(classifyIntent({ raw: q }).primary).toBe('BRAND');
    });
  }

  it('a product query that merely contains "gold" is NOT brand', () => {
    // "memory card gold" is real demand for a product, not navigation to us.
    const r = classifyIntent({ raw: 'memory card gold' });
    expect(r.primary).not.toBe('BRAND');
  });

  it('leaves a genuine typo alone rather than over-fitting to one impression', () => {
    // "shophold" appears once in GSC. Encoding individual misspellings would be
    // fitting the ruleset to noise; it stays UNKNOWN, honestly.
    expect(normalizeQuery('shophold').normalized).not.toContain('goldplus');
  });
});
