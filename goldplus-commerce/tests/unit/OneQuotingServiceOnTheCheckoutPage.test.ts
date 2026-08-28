import { describe, expect, it } from 'vitest';
import { GetDeliveryEstimateUseCase } from '../../apps/api/src/application/use-cases/commerce/DeliveryIntelligenceUseCases';

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

function build(quote: { feeUgx: number | null; confirmed: boolean; mayFallBackToLegacy: boolean } | null) {
  let legacyAsked = false;
  const useCase = new GetDeliveryEstimateUseCase({
    zones: { findByDistrict: async () => { legacyAsked = true; return { enabled: true, feeUgx: 15_000 }; } } as never,
    policy: { get: async () => null } as never,
    observations: { summarizeByDistrict: async () => new Map() } as never,
    quoting: quote ? { quote: async () => quote } : null,
  });
  return { useCase, wasLegacyAsked: () => legacyAsked };
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

  it('still refuses a district that does not exist before asking anyone', async () => {
    const { useCase, wasLegacyAsked } = build({ feeUgx: 1, confirmed: true, mayFallBackToLegacy: false });
    const r = await useCase.execute({ district: 'Atlantis' });
    expect(r.ok).toBe(false);
    expect(wasLegacyAsked()).toBe(false);
  });
});
