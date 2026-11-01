import { describe, it, expect } from 'vitest';
import { UGANDA_DISTRICTS, UGANDA_PLACE_ALIASES, normalizeUgandaDistrict } from '@goldplus/shared';

/**
 * The location vocabulary is the boundary that keeps mis-zoned deliveries out
 * of the order book. The previous gazetteer filed Kireka and Nansana under
 * Mukono (both are Wakiso) and lost Wakiso district entirely — these tests
 * exist so that class of wrongness cannot re-enter silently.
 */
describe('Uganda location vocabulary', () => {
  it('carries all 136 district-level units, unique, with no blank entries', () => {
    expect(UGANDA_DISTRICTS.length).toBe(136);
    expect(new Set(UGANDA_DISTRICTS.map((d) => d.toUpperCase())).size).toBe(136);
    expect(UGANDA_DISTRICTS.every((d) => d.trim().length > 1)).toBe(true);
  });

  it('includes the metro districts the old dataset broke or lost', () => {
    for (const must of ['Wakiso', 'Kampala', 'Mukono', 'Arua', 'Masaka', 'Kasese', 'Luwero']) {
      expect(UGANDA_DISTRICTS).toContain(must);
    }
  });

  it('maps every alias to a district that exists — an alias can never invent a district', () => {
    const canonical = new Set(UGANDA_DISTRICTS);
    for (const alias of UGANDA_PLACE_ALIASES) {
      expect(canonical.has(alias.district), `${alias.area} -> ${alias.district}`).toBe(true);
      expect(alias.area.trim().length).toBeGreaterThan(1);
    }
  });

  it('fixes the exact mis-mappings the old data shipped', () => {
    const byArea = new Map(UGANDA_PLACE_ALIASES.map((a) => [a.area, a.district]));
    expect(byArea.get('Kireka')).toBe('Wakiso'); // old data said Mukono
    expect(byArea.get('Nansana')).toBe('Wakiso'); // old data said Mukono
    expect(byArea.get('Najjera')).toBe('Wakiso'); // old data had no Najjera at all
    expect(byArea.get('Entebbe')).toBe('Wakiso');
    expect(byArea.get('Seeta')).toBe('Mukono');
    expect(byArea.get('Fort Portal')).toBe('Kabarole');
  });

  it('normalises case, whitespace and known variant spellings', () => {
    expect(normalizeUgandaDistrict('  wakiso ')).toBe('Wakiso');
    expect(normalizeUgandaDistrict('KAMPALA')).toBe('Kampala');
    expect(normalizeUgandaDistrict('Luweero')).toBe('Luwero');
    expect(normalizeUgandaDistrict('Ssembabule')).toBe('Sembabule');
    expect(normalizeUgandaDistrict('Fort Portal')).toBe('Kabarole');
    expect(normalizeUgandaDistrict('madi okollo')).toBe('Madi-Okollo');
  });

  it('refuses what it cannot verify instead of guessing', () => {
    expect(normalizeUgandaDistrict('Atlantis')).toBeNull();
    expect(normalizeUgandaDistrict('')).toBeNull();
    expect(normalizeUgandaDistrict(null)).toBeNull();
    // A neighbourhood is not a district — the alias layer, not the district
    // normaliser, owns that mapping.
    expect(normalizeUgandaDistrict('Najjera')).toBeNull();
  });
});
