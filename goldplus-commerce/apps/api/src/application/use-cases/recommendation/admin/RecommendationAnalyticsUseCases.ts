import {
  IRecommendationEventRepository,
  RecommendationEventInput,
} from '../../../ports/IRecommendationAdminRepositories';

const VALID_EVENTS = new Set(['impression', 'click', 'add_to_cart', 'purchase']);

export type RecordEventResult = { ok: true } | { ok: false; code: string; message: string };

/** Ingests first-party recommendation interaction events for measurement. */
export class RecordRecommendationEventUseCase {
  constructor(private readonly events: IRecommendationEventRepository) {}

  async execute(input: RecommendationEventInput): Promise<RecordEventResult> {
    if (!VALID_EVENTS.has(input.eventType)) {
      return { ok: false, code: 'BAD_EVENT', message: 'eventType must be impression, click, add_to_cart, or purchase.' };
    }
    if (!input.surface || !input.surface.trim()) {
      return { ok: false, code: 'BAD_SURFACE', message: 'surface is required.' };
    }
    await this.events.record(input);
    return { ok: true };
  }
}

export interface SurfaceDashboardRow {
  surface: string;
  impressions: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  ctr: number;
  addToCartRate: number;
  conversionRate: number;
}

export interface RecommendationDashboard {
  since: string;
  days: number;
  totals: { impressions: number; clicks: number; addToCarts: number; purchases: number; ctr: number };
  surfaces: SurfaceDashboardRow[];
  topSurfaces: SurfaceDashboardRow[];
  worstSurfaces: SurfaceDashboardRow[];
}

const rate = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 10000) / 10000 : 0);

export class GetRecommendationDashboardUseCase {
  constructor(private readonly events: IRecommendationEventRepository) {}

  async execute(opts: { days?: number } = {}): Promise<RecommendationDashboard> {
    const days = Math.min(Math.max(1, Math.floor(opts.days ?? 30)), 180);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.events.surfacePerformanceSince(since);

    const surfaces: SurfaceDashboardRow[] = rows.map((r) => ({
      ...r,
      ctr: rate(r.clicks, r.impressions),
      addToCartRate: rate(r.addToCarts, r.impressions),
      conversionRate: rate(r.purchases, r.impressions),
    }));

    const totals = surfaces.reduce(
      (acc, s) => ({
        impressions: acc.impressions + s.impressions,
        clicks: acc.clicks + s.clicks,
        addToCarts: acc.addToCarts + s.addToCarts,
        purchases: acc.purchases + s.purchases,
      }),
      { impressions: 0, clicks: 0, addToCarts: 0, purchases: 0 }
    );

    // Rank by CTR but only surfaces with meaningful exposure.
    const ranked = [...surfaces].filter((s) => s.impressions >= 20).sort((a, b) => b.ctr - a.ctr);

    return {
      since: since.toISOString(),
      days,
      totals: { ...totals, ctr: rate(totals.clicks, totals.impressions) },
      surfaces,
      topSurfaces: ranked.slice(0, 5),
      worstSurfaces: ranked.slice(-5).reverse(),
    };
  }
}
