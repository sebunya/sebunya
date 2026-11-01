import { describe, expect, it } from 'vitest';
import { DeliveryQuotingUseCase, withMeasuredDistance } from '../../apps/api/src/application/use-cases/delivery/DeliveryQuotingUseCase';
import {
  ADDITIVE_NEUTRAL_FACTOR,
  AreaInput,
  NEUTRAL_FACTOR,
  accuracyTierFor,
  bandMidpointKm,
  isCentroidSource,
} from '../../apps/api/src/domain/delivery/DeliveryModel';

/**
 * 0189 (address system spec, Phase A): every quote records how precisely the
 * customer's location was known and the km to the area's point, and the fee
 * uses that km ONLY when the registry says so. Loading the points must move no
 * fee by itself.
 */

const CONFIG = {
  effective_speed_kmh: 18.6667,
  rider_cost_per_minute_ugx: 111.1111,
  handling_minutes: 15,
  margin_multiplier: 1.3,
  minimum_fee_ugx: 3000,
  fee_rounding_step_ugx: 500,
};

function harness(opts: { centroidKm: number | null; distanceSource?: string; hasPin?: boolean }) {
  const repo = {
    factorsFor: async () => ({
      corridor: NEUTRAL_FACTOR,
      hour: NEUTRAL_FACTOR,
      detour: NEUTRAL_FACTOR,
      lastMile: ADDITIVE_NEUTRAL_FACTOR,
      areaSampleSize: 0,
      observedMinutes: null,
    }),
    zoneFreeDeliveryThresholdUgx: async () => null,
    cardsFor: async () => [],
    officeFor: async () => null,
    shippingClassesFor: async () =>
      new Map([['p1', { productShippingClass: 'SMALL', categoryShippingClass: null, productName: 'Battery', priceUgx: 10_000 }]]),
    hasActiveOrigin: async () => true,
    activeOriginCode: async () => 'HUB',
  };
  const input: AreaInput = {
    areaSlug: 'kampala-ntinda-10318',
    district: 'Kampala',
    corridor: 'NTINDA',
    band: 'B2',
    accessMode: 'road',
    serviceable: true,
    measuredKm: null,
    centroidSource: opts.centroidKm === null ? null : 'parish_centroid',
    centroidKm: opts.centroidKm,
    centroidExpectedErrorM: opts.centroidKm === null ? null : 412,
  };
  const resolver = { forOrderLocation: async () => ({ input, label: 'Ntinda, Kampala', via: 'area_slug', aliasUsed: null }) };
  const config = {
    currentValues: async () => ({ own_rider_max_band: 'B4', ...(opts.distanceSource ? { distance_source: opts.distanceSource } : {}) }),
    numericValues: async () => ({ ...CONFIG }),
    publishedVersionId: async () => 'v1',
  };
  const uc = new DeliveryQuotingUseCase(repo as never, resolver as never, config);
  return uc.execute({ areaSlug: 'kampala-ntinda-10318', items: [{ productId: 'p1', quantity: 1 }], hasPin: opts.hasPin });
}

describe('accuracy tier', () => {
  it('names the best thing we knew about the location', () => {
    expect(accuracyTierFor({ hasPin: true, centroidKm: null, band: null })).toBe('PIN');
    expect(accuracyTierFor({ hasPin: false, centroidKm: 6.1, band: 'B2' })).toBe('AREA_POINT');
    expect(accuracyTierFor({ hasPin: false, centroidKm: null, band: 'B2' })).toBe('BAND_MIDPOINT');
    expect(accuracyTierFor({ hasPin: false, centroidKm: null, band: null })).toBe('DISTRICT');
    expect(accuracyTierFor({ hasPin: false, centroidKm: Number.NaN, band: 'B1' })).toBe('BAND_MIDPOINT');
  });
  it('knows the centroid sources and nothing else', () => {
    expect(isCentroidSource('parish_centroid')).toBe(true);
    expect(isCentroidSource('manual')).toBe(true);
    expect(isCentroidSource('geonames')).toBe(false);
    expect(isCentroidSource(null)).toBe(false);
  });
});

describe('measured distance reaches the fee only through distance_source', () => {
  it('without the key, the point is recorded but the band midpoint prices the fee', async () => {
    const out = await harness({ centroidKm: 6.1 });
    expect(out.quote.kind).toBe('rider_delivery');
    expect(out.quote.explanation.distanceSource).toBe('band_midpoint');
    expect(out.quote.explanation.oneWayKm).toBe(bandMidpointKm('B2'));
    expect(out.quote.explanation.centroidKm).toBe(6.1);
    expect(out.quote.explanation.centroidExpectedErrorM).toBe(412);
    expect(out.quote.explanation.centroidSource).toBe('parish_centroid');
    expect(out.quote.explanation.accuracyTier).toBe('AREA_POINT');
  });
  it("with distance_source = 'measured', the point's km prices the fee", async () => {
    const out = await harness({ centroidKm: 6.1, distanceSource: 'measured' });
    expect(out.quote.explanation.distanceSource).toBe('measured_centroid');
    expect(out.quote.explanation.oneWayKm).toBe(6.1);
    expect(out.quote.explanation.accuracyTier).toBe('AREA_POINT');
  });
  it("with 'measured' but no point, the band midpoint still prices and the tier says so", async () => {
    const out = await harness({ centroidKm: null, distanceSource: 'measured' });
    expect(out.quote.explanation.distanceSource).toBe('band_midpoint');
    expect(out.quote.explanation.centroidKm).toBeNull();
    expect(out.quote.explanation.accuracyTier).toBe('BAND_MIDPOINT');
  });
  it('a customer pin is the PIN tier whatever the area knows', async () => {
    const out = await harness({ centroidKm: 6.1, hasPin: true });
    expect(out.quote.explanation.accuracyTier).toBe('PIN');
  });
  it('the helper never prices on a missing or negative km', () => {
    const base: AreaInput = { areaSlug: 'x', corridor: 'C', band: 'B1', accessMode: 'road', serviceable: true, measuredKm: null, centroidSource: null };
    expect(withMeasuredDistance({ ...base, centroidKm: 3.2 }, 'measured').measuredKm).toBe(3.2);
    expect(withMeasuredDistance({ ...base, centroidKm: 3.2 }, 'band_midpoint').measuredKm).toBeNull();
    expect(withMeasuredDistance({ ...base, centroidKm: 3.2 }, null).measuredKm).toBeNull();
    expect(withMeasuredDistance({ ...base, centroidKm: -1 }, 'measured').measuredKm).toBeNull();
    expect(withMeasuredDistance(base, 'measured').measuredKm).toBeNull();
  });
});
