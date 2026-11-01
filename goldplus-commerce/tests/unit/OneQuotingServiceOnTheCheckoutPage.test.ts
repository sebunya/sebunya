import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetDeliveryEstimateUseCase } from '../../apps/api/src/application/use-cases/commerce/DeliveryIntelligenceUseCases';
import { manualDeliveryAreaLine } from '../../apps/web/src/lib/deliveryQuotePanel';
import { prepareCheckoutPayload } from '../../apps/web/src/lib/checkout';

/**
 * The delivery figure the checkout page SHOWS must be the figure the order is
 * CHARGED (docs/delivery/CONTRACT.md, guarantee #1: exactly one quoting service).
 *
 * WHAT WAS WRONG
 * /commerce/delivery-estimate drove the page's "Delivery" row and grand total
 * from the legacy zone/band model alone, while CheckoutUseCase charged the
 * quoting service's fee. Gulu was the concrete case: an enabled zone row said
 * 15,000, so the totals showed goods + 15,000, while the service resolved it to
 * a bus parcel with no rate card and the order was created with fee 0,
 * unconfirmed. Two quoting paths, two answers, one page.
 *
 * The estimate now asks the quoting service first, under exactly the rule the
 * checkout applies: the legacy model is consulted only on CONFIG_INCOMPLETE.
 */

function build(quote: { feeUgx: number | null; confirmed: boolean; mayFallBackToLegacy: boolean; unavailableReason?: string | null } | null) {
  let legacyAsked = false;
  const asked: unknown[] = [];
  const useCase = new GetDeliveryEstimateUseCase({
    zones: { findByDistrict: async () => { legacyAsked = true; return { enabled: true, feeUgx: 15_000 }; } } as never,
    policy: { get: async () => null } as never,
    observations: { summarizeByDistrict: async () => new Map() } as never,
    quoting: quote ? { quote: async (input: unknown) => { asked.push(input); return quote; } } : null,
  });
  return { useCase, wasLegacyAsked: () => legacyAsked, asked };
}

describe('the estimate is the quoting service’s answer', () => {
  it('shows the fee the order will be charged', async () => {
    const { useCase, wasLegacyAsked } = build({ feeUgx: 8_000, confirmed: true, mayFallBackToLegacy: false });
    const r = await useCase.execute({ district: 'Kampala' });
    expect(r.ok && r.estimate.kind).toBe('CONFIRMED');
    expect(r.ok && r.estimate.feeUgx).toBe(8_000);
    expect(wasLegacyAsked()).toBe(false);
  });

  it('says UNAVAILABLE when the service truthfully cannot price it, instead of the zone row', async () => {
    // The Gulu case: the zone row says 15,000, the service says it cannot
    // price this. The order is charged 0 unconfirmed, so the page must not
    // promise 15,000.
    const { useCase } = build({ feeUgx: null, confirmed: false, mayFallBackToLegacy: false });
    const r = await useCase.execute({ district: 'Gulu' });
    expect(r.ok && r.estimate.kind).toBe('UNAVAILABLE');
    expect(r.ok && r.estimate.feeUgx).toBeNull();
  });

  it('falls back to the legacy model only on CONFIG_INCOMPLETE, exactly as checkout does', async () => {
    const { useCase, wasLegacyAsked } = build({ feeUgx: null, confirmed: false, mayFallBackToLegacy: true });
    await useCase.execute({ district: 'Kampala' });
    expect(wasLegacyAsked()).toBe(true);
  });

  it('on CONFIG_INCOMPLETE it shows only what checkout charges: the enabled zone fee, else nothing (never a band seed figure)', async () => {
    const withZone = build({ feeUgx: null, confirmed: false, mayFallBackToLegacy: true });
    const zoned = await withZone.useCase.execute({ district: 'Kampala', area: 'Ntinda' });
    expect(zoned.ok && zoned.estimate).toMatchObject({ kind: 'CONFIRMED', feeUgx: 15_000, source: 'ZONE' });
    // No zone row: checkout charges 0 unconfirmed and the panel says pricing is being finalised. The row used to
    // say "about UGX 8,000" from DEFAULT_DELIVERY_BAND_POLICY.
    const noZone = new GetDeliveryEstimateUseCase({
      zones: { findByDistrict: async () => null } as never,
      policy: { get: async () => { throw new Error('the band policy must not be read for a checkout figure'); } } as never,
      observations: { summarizeByDistrict: async () => { throw new Error('nor the observed medians'); } } as never,
      quoting: { quote: async () => ({ feeUgx: null, confirmed: false, mayFallBackToLegacy: true }) },
    });
    const r = await noZone.execute({ district: 'Kampala', area: 'Ntinda' });
    expect(r.ok && r.estimate).toMatchObject({ kind: 'UNAVAILABLE', feeUgx: null });
    const disabled = new GetDeliveryEstimateUseCase({
      zones: { findByDistrict: async () => ({ enabled: false, feeUgx: 9_000 }) } as never,
      policy: {} as never, observations: {} as never,
      quoting: { quote: async () => ({ feeUgx: null, confirmed: false, mayFallBackToLegacy: true }) },
    });
    const d = await disabled.execute({ district: 'Kampala' });
    expect(d.ok && d.estimate.kind).toBe('UNAVAILABLE');
  });

  it("the quote panel keys its zone fallback on the customer's district first, as checkout does", () => {
    const route = readFileSync(join(__dirname, '../../apps/api/src/interfaces/http/routes/delivery.ts'), 'utf8');
    expect(route).toMatch(/const districtName = district \|\| outcome\.resolved\?\.input\.district;/);
  });

  it('still refuses a district that does not exist before asking anyone', async () => {
    const { useCase, wasLegacyAsked } = build({ feeUgx: 1, confirmed: true, mayFallBackToLegacy: false });
    const r = await useCase.execute({ district: 'Atlantis' });
    expect(r.ok).toBe(false);
    expect(wasLegacyAsked()).toBe(false);
  });

  it('a per-parcel refusal (NO_RATE_CARD) is UNAVAILABLE, never the zone row or the seed band defaults', async () => {
    // The "basket-derived" escape handed this to the legacy model, which showed
    // the Gulu zone's 15,000 as CONFIRMED (or an invented 'about 20,000' from
    // DEFAULT_DELIVERY_BAND_POLICY) while CheckoutUseCase — same destination,
    // same refusal, mayFallBackToLegacy false — charged 0, unconfirmed.
    for (const unavailableReason of ['NO_RATE_CARD', 'PARCEL_CLASS_UNKNOWN']) {
      const { useCase, wasLegacyAsked } = build({ feeUgx: null, confirmed: false, mayFallBackToLegacy: false, unavailableReason });
      const r = await useCase.execute({ district: 'Gulu', area: 'Laroo' });
      expect(r.ok && r.estimate.kind).toBe('UNAVAILABLE');
      expect(r.ok && r.estimate.feeUgx).toBeNull();
      expect(wasLegacyAsked()).toBe(false);
    }
  });

  it('asks the quoting service the same question checkout charges on: basket and area slug included', async () => {
    const { useCase, asked } = build({ feeUgx: 12_000, confirmed: true, mayFallBackToLegacy: false });
    const r = await useCase.execute({
      district: 'Gulu',
      area: 'Laroo, Gulu',
      areaSlug: 'gulu-laroo',
      items: [{ productId: 'p1', quantity: 2 }],
    });
    expect(r.ok && r.estimate.feeUgx).toBe(12_000);
    expect(asked[0]).toEqual({
      areaSlug: 'gulu-laroo',
      district: 'Gulu',
      deliveryArea: 'Laroo, Gulu',
      items: [{ productId: 'p1', quantity: 2 }],
    });
  });
});

describe('a typed (manual) location is quoted with the area line the order is placed with', () => {
  const form = (loc: Record<string, unknown>) => {
    const f = new FormData();
    f.set('locationJson', JSON.stringify(loc));
    f.set('name', 'A'); f.set('phone', '0772000000');
    return f;
  };

  it('the page and the order build the same line, with or without a district', () => {
    for (const loc of [{ manual: true, rawAddressText: 'Najjera', district: 'Wakiso' }, { manual: true, rawAddressText: 'Najjera near the stage' }]) {
      const order = prepareCheckoutPayload(form(loc), []);
      expect(order.customerDetails.deliveryArea).toBe(manualDeliveryAreaLine(loc.rawAddressText, (loc as { district?: string }).district));
    }
    expect(manualDeliveryAreaLine('Najjera', 'Wakiso')).toBe('Najjera, Wakiso');
  });

  it('the checkout page asks with that line (it used to send the district alone: "confirmed by phone", fee left out)', () => {
    const page = readFileSync(join(__dirname, '../../apps/web/src/pages/checkout.astro'), 'utf8');
    expect(page).toMatch(/loc\?\.manual && loc\.rawAddressText\) \{ refreshEstimate\(loc\.district \? String\(loc\.district\) : null, manualDeliveryAreaLine\(loc\.rawAddressText, loc\.district\)/);
    expect(page).toMatch(/if \(!district && !area\) \{ renderEstimate\(null, false\); return; \}/);
  });

  it('with no district, the estimate asks the quoting service exactly as checkout does (district null)', async () => {
    const { useCase, asked, wasLegacyAsked } = build({ feeUgx: 9_000, confirmed: true, mayFallBackToLegacy: false });
    const r = await useCase.execute({ district: '', area: 'Najjera near the stage' });
    expect(r.ok && r.estimate).toMatchObject({ kind: 'CONFIRMED', feeUgx: 9_000 });
    expect(asked[0]).toMatchObject({ district: null, deliveryArea: 'Najjera near the stage' });
    expect(wasLegacyAsked()).toBe(false);
  });

  it('with no district and incomplete config there is no legacy figure to show: UNAVAILABLE, never invented', async () => {
    const { useCase, wasLegacyAsked } = build({ feeUgx: null, confirmed: false, mayFallBackToLegacy: true });
    const r = await useCase.execute({ district: '', area: 'Najjera' });
    expect(r.ok && r.estimate).toMatchObject({ kind: 'UNAVAILABLE', feeUgx: null });
    expect(wasLegacyAsked()).toBe(false);
  });

  it('neither a district nor an area is still refused', async () => {
    const { useCase } = build({ feeUgx: 1, confirmed: true, mayFallBackToLegacy: false });
    expect((await useCase.execute({ district: '' })).ok).toBe(false);
  });
});
