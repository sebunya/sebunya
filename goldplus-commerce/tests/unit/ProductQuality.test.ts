import { describe, it, expect } from 'vitest';
import { scoreProductQuality, ProductQualityInput } from '../../apps/api/src/domain/products/ProductQuality';

const rich: ProductQualityInput = {
  productId: 'p1',
  name: 'GoldPlus 200Ah Deep-Cycle Solar Battery',
  shortDescription: 'Sealed deep-cycle battery for solar backup systems, 200Ah capacity.',
  longDescription: 'A maintenance-free sealed lead-acid deep-cycle battery rated at 200Ah, designed for solar backup and inverter systems. Long service life, deep discharge tolerance, and stable output for home and light-commercial installations across Uganda.',
  hasImage: true,
  priceUgx: 1_200_000,
  hasRetailPrice: true,
  categoryName: 'Batteries',
  modelNumber: 'GP-200AH-DC',
  warrantyPeriod: '2 Years',
  specificationsCount: 6,
};

const sparse: ProductQualityInput = {
  productId: 'p2',
  name: 'Item',
  shortDescription: '',
  longDescription: '',
  hasImage: false,
  priceUgx: 0,
  hasRetailPrice: false,
  categoryName: null,
  modelNumber: '',
  warrantyPeriod: '',
  specificationsCount: 0,
};

describe('scoreProductQuality', () => {
  it('scores a rich product highly and marks it feed-eligible', () => {
    const s = scoreProductQuality(rich);
    expect(s.overall).toBeGreaterThanOrEqual(85);
    expect(s.feedEligibility.eligible).toBe(true);
    expect(s.completeness.missing).toEqual([]);
    expect(s.assistantReadiness.score).toBeGreaterThanOrEqual(80);
  });

  it('scores a sparse product low, ineligible, and lists exactly what is missing', () => {
    const s = scoreProductQuality(sparse);
    expect(s.overall).toBeLessThan(30);
    expect(s.feedEligibility.eligible).toBe(false);
    expect(s.feedEligibility.missing).toEqual(
      expect.arrayContaining(['description', 'image', 'price', 'category', 'MPN/model']),
    );
    expect(s.completeness.missing).toContain('image');
    expect(s.completeness.missing).toContain('retail price (>0)');
  });

  it('is deterministic and every sub-score is within 0..100', () => {
    const a = scoreProductQuality(rich);
    const b = scoreProductQuality(rich);
    expect(a).toEqual(b);
    for (const sub of [a.completeness, a.feedEligibility, a.seoReadiness, a.aeoReadiness, a.assistantReadiness]) {
      expect(sub.score).toBeGreaterThanOrEqual(0);
      expect(sub.score).toBeLessThanOrEqual(100);
    }
  });

  it('penalises feed eligibility for a single missing required field', () => {
    const noImage = scoreProductQuality({ ...rich, hasImage: false });
    expect(noImage.feedEligibility.eligible).toBe(false);
    expect(noImage.feedEligibility.missing).toEqual(['image']);
  });

  it('rewards structured specifications for AEO and assistant readiness', () => {
    const noSpecs = scoreProductQuality({ ...rich, specificationsCount: 0 });
    expect(noSpecs.aeoReadiness.score).toBeLessThan(scoreProductQuality(rich).aeoReadiness.score);
    expect(noSpecs.assistantReadiness.missing).toContain('specifications to ground answers');
  });
});
