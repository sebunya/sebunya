import { describe, expect, it } from 'vitest';
import { DeliveryQuotingUseCase } from '../../apps/api/src/application/use-cases/delivery/DeliveryQuotingUseCase';

/**
 * A carrier's rate card names a town and its district ("Fort Portal, Kabarole"). Quoting asked for cards with
 * town = district for both, so a card for any town not named after its district could never match: every such
 * order went to the manual queue at 0 (NO_RATE_CARD). The area's own town is tried first now, then the district's
 * town, which keeps every card that already matched ("Gulu, Gulu") working.
 */
const prior = { value: 1, n: 0, source: 'prior' } as never;

function harness(area: { slug: string; label: string; district: string; districtOnly?: boolean }, cardTowns: Array<[string, string]>) {
  const asked: Array<{ town: string; district: string }> = [];
  const offices: Array<{ town: string; district: string }> = [];
  const repo = {
    factorsFor: async () => ({ corridor: prior, hour: prior, detour: prior, lastMile: prior, areaSampleSize: 0, observedMinutes: null }),
    zoneFreeDeliveryThresholdUgx: async () => null,
    cardsFor: async (i: { town: string; district: string }) => {
      asked.push(i);
      return cardTowns
        .filter(([t]) => t.toLowerCase() === i.town.toLowerCase())
        .map(([t, d], n) => ({ id: `c${n}`, carrier: 'Link', destinationTown: t, destinationDistrict: d, parcelClass: 'SMALL', feeUgx: 10_000, insurancePctOfDeclaredValue: null, transitDaysMin: 1, transitDaysMax: 2, chargedAt: 'dispatch', effectiveFrom: new Date(0), effectiveTo: null, version: 1 })) as never;
    },
    officeFor: async (i: { town: string; district: string }) => { offices.push(i); return null; },
    shippingClassesFor: async () => new Map([['p1', { productShippingClass: 'SMALL', categoryShippingClass: null, productName: 'Battery', priceUgx: 100_000 }]]),
    hasActiveOrigin: async () => true,
    activeOriginCode: async () => 'KLA',
  };
  const resolver = {
    forOrderLocation: async () => ({
      input: { areaSlug: area.slug, districtOnly: area.districtOnly ?? false, district: area.district, corridor: null, band: null, accessMode: null, serviceable: true, measuredKm: null, centroidSource: null },
      label: area.label, via: 'area_slug', aliasUsed: null,
    }),
  };
  const config = { currentValues: async () => ({}), numericValues: async () => ({}), publishedVersionId: async () => null };
  const uc = new DeliveryQuotingUseCase(repo as never, resolver as never, config);
  return { run: () => uc.execute({ areaSlug: area.slug, items: [{ productId: 'p1', quantity: 1 }] }), asked, offices };
}

describe('bus parcel rate cards are found by the destination town', () => {
  it('a card for "Fort Portal, Kabarole" is found for an order to Fort Portal', async () => {
    const h = harness({ slug: 'kabarole-fort-portal', label: 'Fort Portal, Kabarole', district: 'Kabarole' }, [['Fort Portal', 'Kabarole']]);
    await h.run().catch(() => undefined);
    expect(h.asked[0]).toEqual({ town: 'Fort Portal', district: 'Kabarole' });
    expect(h.asked).toHaveLength(1);
    expect(h.offices[0]).toEqual({ town: 'Fort Portal', district: 'Kabarole' });
  });

  it('a district-named card ("Gulu, Gulu") still matches an area inside it, as before', async () => {
    const h = harness({ slug: 'gulu-laroo', label: 'Laroo, Gulu', district: 'Gulu' }, [['Gulu', 'Gulu']]);
    await h.run().catch(() => undefined);
    expect(h.asked.map((a) => a.town)).toEqual(['Laroo', 'Gulu']);
    expect(h.offices[0]).toEqual({ town: 'Gulu', district: 'Gulu' });
  });

  it('a card for a same-named town in ANOTHER district is never taken', async () => {
    const h = harness({ slug: 'x-kira', label: 'Kira, Mukono', district: 'Mukono' }, [['Kira', 'Wakiso']]);
    await h.run().catch(() => undefined);
    expect(h.asked.map((a) => a.town)).toEqual(['Kira', 'Mukono']);
  });

  it('a district-only resolution asks once, with the district as the town', async () => {
    const h = harness({ slug: '', label: 'Gulu', district: 'Gulu', districtOnly: true }, [['Gulu', 'Gulu']]);
    await h.run().catch(() => undefined);
    expect(h.asked).toEqual([{ town: 'Gulu', district: 'Gulu' }]);
  });
});
