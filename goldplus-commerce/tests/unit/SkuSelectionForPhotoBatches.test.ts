import { describe, expect, it } from 'vitest';
import { frameTargets, parseOnly } from '../../apps/api/src/scripts/skuSelection';

/**
 * Batch 4 (2026-10-13): photo batches arrive for DRAFT products. The placeholder
 * clean-up used to skip drafts even when named, so their "Sample" pictures would
 * have stayed in front of the real photos.
 */
const all = [
  { sku: 'GP-W2-PB', active: false },
  { sku: 'GP-W3-PB', active: false },
  { sku: 'GP-L03', active: true },
  { sku: 'GP-B12', active: false },
];

describe('parseOnly', () => {
  it('trims, upper-cases and drops blanks and duplicates', () => {
    expect([...parseOnly(' gp-w2-pb, GP-W2-PB ,,GP-W3-PB ')]).toEqual(['GP-W2-PB', 'GP-W3-PB']);
    expect(parseOnly(undefined).size).toBe(0);
  });
});

describe('frameTargets', () => {
  it('removes placeholders from a named draft', () => {
    expect(frameTargets(all, parseOnly('GP-W2-PB,gp-w3-pb'), 'remove').map((p) => p.sku)).toEqual(['GP-W2-PB', 'GP-W3-PB']);
  });
  it('never adds placeholders to a draft, even when named', () => {
    expect(frameTargets(all, parseOnly('GP-W2-PB,GP-L03'), 'fill').map((p) => p.sku)).toEqual(['GP-L03']);
  });
  it('without ONLY, touches products on sale only, in both modes', () => {
    expect(frameTargets(all, new Set(), 'remove').map((p) => p.sku)).toEqual(['GP-L03']);
    expect(frameTargets(all, new Set(), 'fill').map((p) => p.sku)).toEqual(['GP-L03']);
  });
  it('never touches a product that is not named when ONLY is given', () => {
    expect(frameTargets(all, parseOnly('GP-W2-PB'), 'remove').map((p) => p.sku)).not.toContain('GP-B12');
  });
});
