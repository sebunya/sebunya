import { resolveKampalaPeriod } from '@goldplus/shared';
import type { ISalesFunnelReader, SalesFunnelCounts } from '../../ports/ISalesFunnelReader';
import type { AnalyticsPeriodInput } from './CommerceAnalyticsUseCases';

/**
 * Gap analysis #3 (2026-10-20): one funnel from product page to paid order, with the money lost at each step, so
 * the owner can name the leakiest step in shillings each week and rank the rest of the work by it.
 *
 * Honest about its shape: each step counts a different thing from its own first-party source (product-page
 * events, the carts table, the orders table). They are not one linked cohort, so a step's "carried on" share is a
 * ratio of counts, and a ratio above 1 (more carts than shoppers seen, e.g. carts filled from shop cards) is
 * reported as NOT_COMPARABLE rather than as a 130% conversion.
 */
export type FunnelStepKey = 'viewed' | 'carted' | 'ordered' | 'paid';

export interface FunnelStep {
  key: FunnelStepKey;
  label: string;
  count: number;
  previousCount: number;
  /** count ÷ the step before, 0–1; null for the first step, or when not comparable. */
  carriedOn: number | null;
  carriedOnState: 'OK' | 'FIRST_STEP' | 'NO_DATA' | 'NOT_COMPARABLE';
  /** Money that stopped between the step before and this one, where the shop can measure it. */
  lostUgx: number | null;
  lostLabel: string | null;
}

export interface SalesFunnelResponse {
  period: { startDay: string; endDay: string; days: number };
  steps: FunnelStep[];
  placedValueUgx: number;
  paidValueUgx: number;
  /** The step losing the most measurable money in this window, or null when nothing was lost. */
  leakiest: FunnelStepKey | null;
  sources: Record<FunnelStepKey, string>;
}

function ratio(count: number, before: number): Pick<FunnelStep, 'carriedOn' | 'carriedOnState'> {
  if (before <= 0) return { carriedOn: null, carriedOnState: 'NO_DATA' };
  const r = count / before;
  if (r > 1) return { carriedOn: null, carriedOnState: 'NOT_COMPARABLE' };
  return { carriedOn: Math.round(r * 10_000) / 10_000, carriedOnState: 'OK' };
}

export function buildSalesFunnel(now: SalesFunnelCounts, before: SalesFunnelCounts): Pick<SalesFunnelResponse, 'steps' | 'leakiest' | 'placedValueUgx' | 'paidValueUgx'> {
  const steps: FunnelStep[] = [
    { key: 'viewed', label: 'Opened a product page', count: now.productViewers, previousCount: before.productViewers, carriedOn: null, carriedOnState: 'FIRST_STEP', lostUgx: null, lostLabel: null },
    { key: 'carted', label: 'Carts with items', count: now.cartsWithItems, previousCount: before.cartsWithItems, ...ratio(now.cartsWithItems, now.productViewers), lostUgx: null, lostLabel: null },
    { key: 'ordered', label: 'Orders placed', count: now.ordersPlaced, previousCount: before.ordersPlaced, ...ratio(now.ordersPlaced, now.cartsWithItems), lostUgx: now.abandonedCartValueUgx, lostLabel: `in ${now.abandonedCarts} cart${now.abandonedCarts === 1 ? '' : 's'} left for 6 hours or more` },
    { key: 'paid', label: 'Orders paid', count: now.ordersPaid, previousCount: before.ordersPaid, ...ratio(now.ordersPaid, now.ordersPlaced), lostUgx: now.unpaidOpenValueUgx, lostLabel: 'in orders placed and not paid (not cancelled)' },
  ];
  const measured = steps.filter((s) => (s.lostUgx ?? 0) > 0);
  const leakiest = measured.length ? measured.reduce((a, b) => ((b.lostUgx ?? 0) > (a.lostUgx ?? 0) ? b : a)).key : null;
  return { steps, leakiest, placedValueUgx: now.ordersPlacedValueUgx, paidValueUgx: now.ordersPaidValueUgx };
}

export class GetSalesFunnelUseCase {
  constructor(private readonly reader: ISalesFunnelReader) {}

  async execute(input: AnalyticsPeriodInput): Promise<SalesFunnelResponse> {
    const period = resolveKampalaPeriod(input);
    const [now, before] = await Promise.all([
      this.reader.counts(period.start, period.end),
      this.reader.counts(period.previousStart, period.previousEnd),
    ]);
    return {
      period: { startDay: period.startDay, endDay: period.endDay, days: period.days },
      ...buildSalesFunnel(now, before),
      sources: {
        viewed: 'Product-page views recorded by the storefront, one per shopper per product per 30 minutes, counted once per shopper.',
        carted: 'Server carts holding at least one item, touched in the period (from any surface: product page, shop cards, Goldie).',
        ordered: 'Orders created in the period (the Commerce Analytics order count).',
        paid: 'Of those orders, the ones whose payment status is paid.',
      },
    };
  }
}
