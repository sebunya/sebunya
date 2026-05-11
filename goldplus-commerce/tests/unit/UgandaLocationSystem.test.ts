import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { searchLocations } from '../../apps/web/src/lib/location-search';
import { prepareCheckoutPayload } from '../../apps/web/src/lib/checkout';

describe('Uganda Location Audit Metrics', () => {
  const rawData = JSON.parse(fs.readFileSync('./apps/web/public/data/uganda-locations-final.json', 'utf-8'));

  it('should contain exactly 5,719 records reflecting absolute ledger parity', () => {
    // 5720 source rows minus 1 legitimate anomaly deletion = 5719
    expect(rawData.length).toBe(5719);
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
    // Assert score is boosted by fallback synonym normalization logic
    expect(missMatch[0].score).toBeGreaterThanOrEqual(35);
    
    const hit = missMatch.some(h => h.selection.district.toUpperCase() === 'LUWERO');
    expect(hit).toBe(true);
  });

  it('should safely decompose partial queries avoiding binary fragmentation', () => {
    // Partial intersections like 'Kampala Cent' should still capture correctly.
    const partial = searchLocations('Kampala Cent', rawData, 10);
    expect(partial.length).toBeGreaterThan(0);
    const names = partial.map(p => p.selection.subcountyDivisionTc.toUpperCase());
    expect(names).toContain('CENTRAL');
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
      get: (key: string) => key === 'locationJson' ? JSON.stringify(validMockSelection) : ''
    } as any;

    const payload = prepareCheckoutPayload(goodForm, []);
    // Expect full preservation of composite fields formatted correctly
    expect(payload.customerDetails.deliveryArea).toContain("Wakiso");
    expect(payload.customerDetails.deliveryArea).toContain("Kireka");
    expect(payload.customerDetails.deliveryAddress).toContain("Central Region");
    expect(payload.customerDetails.deliveryAddress).toContain("Kyadondo");
  });
});
