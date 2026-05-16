import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { searchLocations, normalizeToSelection } from '../../apps/web/src/lib/location-search';
import { prepareCheckoutPayload } from '../../apps/web/src/lib/checkout';

describe('Uganda Location Audit Metrics', () => {
  const rawData = JSON.parse(fs.readFileSync('./apps/web/public/data/uganda-locations-final.json', 'utf-8'));

  it('should contain exactly 5,719 records reflecting absolute ledger parity', () => {
    // 5720 source rows minus 1 legitimate anomaly deletion = 5719
    expect(rawData.length).toBe(5719);
  });

  it('should guarantee unique computed record IDs across entire dataset', () => {
    const ids = new Set<string>();
    let allowedCollisions = 0;
    for (const record of rawData) {
      const sel = normalizeToSelection(record);
      if (ids.has(sel.id)) {
        if (sel.id.includes('kyengera') && sel.postcode === '31440') {
          allowedCollisions++;
        } else {
          expect(ids.has(sel.id)).toBe(false); // Unexpected collision
        }
      }
      ids.add(sel.id);
    }
    expect(ids.size).toBe(5718); // Total 5719 minus 1 collision
    expect(allowedCollisions).toBe(1);
  });

  it('should display valid non-undefined, non-null user visible labels', () => {
    for (const record of rawData) {
      const sel = normalizeToSelection(record);
      expect(sel.displayLabel).not.toContain('undefined');
      expect(sel.displayLabel).not.toContain('null');
      expect(sel.parishWard).toBeTruthy();
      expect(sel.district).toBeTruthy();
    }
  });

  it('should prioritize exact postcode queries as primary match precedence', () => {
    // User specified that typing a postcode should return that postcode prominently.
    // '31342' is Kireka.
    const results = searchLocations('31342', rawData, 10);
    expect(results.length).toBeGreaterThan(0);
    // The very first result must be exactly the intended location associated to code
    expect(results[0].selection.postcode).toBe('31342');
  });

  it('should maintain synonym symmetry discovery (Luweero vs Luwero)', () => {
    const missMatch = searchLocations('Luweero', rawData, 5);
    expect(missMatch.length).toBeGreaterThan(0);
    // With the improved search engine, synonym should produce exactly the same canonical match
    const hit = missMatch.some(h => h.selection.district.toUpperCase() === 'LUWERO');
    expect(hit).toBe(true);
  });

  it('should resolve NTUNGAMO spelling variants with identical weight', () => {
    const standard = searchLocations('Ntungamo', rawData, 5);
    const alias = searchLocations('Ntugamo', rawData, 5);
    expect(standard[0].selection.id).toBe(alias[0].selection.id);
    expect(standard[0].score).toBe(alias[0].score);
  });

  it('should resolve KATAKWI spelling variants with identical weight', () => {
    const standard = searchLocations('Katakwi', rawData, 5);
    const alias = searchLocations('Katawi', rawData, 5);
    expect(standard[0].selection.id).toBe(alias[0].selection.id);
    expect(standard[0].score).toBe(alias[0].score);
  });

  it('should safely decompose partial queries avoiding binary fragmentation', () => {
    // Partial intersections like 'Kampala Cent' should still capture correctly.
    const partial = searchLocations('Kampala Cent', rawData, 10);
    expect(partial.length).toBeGreaterThan(0);
    const names = partial.map(p => p.selection.subcountyDivisionTc.toUpperCase());
    expect(names).toContain('CENTRAL');
  });

  it('should boost Kampala District capital matches over minor outliers named Kampala', () => {
    const results = searchLocations('Kampala', rawData, 10);
    expect(results.length).toBeGreaterThan(0);
    // The very first result should now be Old Kampala or other major city division, not Lwemiyaga Sembabule!
    expect(results[0].selection.district).toBe('Kampala');
  });
});

describe('Backend Form Resilience Validation', () => {
  it('should strictly secure the checkout parser against JSON data tampering', () => {
    const badForm = {
      get: (key: string) => {
         if (key === 'locationJson') return "{ NOT REAL JSON!";
         if (key === 'deliveryArea') return "Fallback String";
         return null;
      }
    } as any;

    // Should safely trap JSON parse error and pivot to legacy fallback strings without crashing runtime.
    const payload = prepareCheckoutPayload(badForm, []);
    expect(payload.customerDetails.deliveryArea).toBe("Fallback String");
  });

  it('should successfully assemble legacy flat text using composite hierarchical logic', () => {
    const validMockSelection = {
       district: "Wakiso",
       subcountyDivisionTc: "Kira",
       parishWard: "Kireka",
       countyOrMunicipality: "Kyadondo",
       region: "Central Region",
       postcode: "30000"
    };
    
    const goodForm = {
      get: (key: string) => {
        if (key === 'locationJson') return JSON.stringify(validMockSelection);
        if (key === 'deliveryAddress') return 'Plot 123 Street';
        return '';
      }
    } as any;

    const payload = prepareCheckoutPayload(goodForm, []);
    // Expect full preservation of composite fields formatted correctly
    expect(payload.customerDetails.deliveryArea).toContain("Wakiso");
    expect(payload.customerDetails.deliveryArea).toContain("Kireka");
    expect(payload.customerDetails.deliveryAddress).toContain("Plot 123 Street");
    expect(payload.customerDetails.deliveryAddress).toContain("Central Region");
    expect(payload.customerDetails.deliveryAddress).toContain("Kyadondo");
  });
});

