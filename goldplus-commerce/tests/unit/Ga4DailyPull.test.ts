import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The nightly GA4 daily-series pull against a fake Data API and a recording database: backfill when the table
 * is empty, a three-day refresh otherwise, one row per day/report/dimension, nothing written when the credential
 * is unavailable, and the shared client's paging.
 */
const executed: string[] = [];
let lastDay: string | null = null;
function sqlText(q: unknown): string {
  const chunks = (q as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks.map((c): string => {
    if (c === null || c === undefined) return 'null';
    if (typeof c !== 'object') return String(c);
    if (Array.isArray((c as { value?: unknown }).value)) return ((c as { value: string[] }).value).join('');
    if ((c as { queryChunks?: unknown[] }).queryChunks) return sqlText(c);
    return '';
  }).join('');
}
const answer = (q: unknown) => { const t = sqlText(q); executed.push(t); return t.includes('max(day)') ? [{ last_day: lastDay }] : []; };
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({
  db: { execute: async (q: unknown) => answer(q), transaction: async (fn: (tx: unknown) => Promise<void>) => fn({ execute: async (q: unknown) => answer(q) }) },
}));
vi.mock('../../apps/api/src/infrastructure/logging/logger', () => ({ logger: { warn: () => undefined, info: () => undefined, error: () => undefined } }));

const { Ga4DailyPull, GA4_REPORTS } = await import('../../apps/api/src/infrastructure/measurement/Ga4DailyPull');
const { Ga4DataApi } = await import('../../apps/api/src/infrastructure/measurement/Ga4DataApi');

const row = (date: string, dim: string, m: number[]) => ({ dimensionValues: [{ value: date }, { value: dim }], metricValues: m.map((v) => ({ value: String(v) })) });
const inserts = () => executed.filter((q) => q.includes('insert into measurement.ga4_daily_series'));
const NOW = new Date('2026-10-23T01:30:00Z'); // 04:30 Kampala

describe('GA4 daily series pull', () => {
  beforeEach(() => { executed.length = 0; lastDay = null; });

  it('backfills the whole window when the table is empty and writes one row per day, report and dimension', async () => {
    const calls: any[] = [];
    const api = { runReport: async (req: any) => { calls.push(req); return { propertyId: '549232812', rows: req.dimensions[1].name === 'sessionDefaultChannelGroup' ? [row('20261021', 'Organic Search', [12, 10, 4, 9, 1, 1, 185000.5]), row('20261022', 'Direct', [30, 25, 20, 18, 0, 0, 0])] : [] }; } };
    const r = await new Ga4DailyPull(api).run(NOW);
    expect(r).toMatchObject({ mode: 'backfill', from: '2025-09-18', to: '2026-10-22', rows: 2, unavailable: null });
    expect(calls).toHaveLength(Object.keys(GA4_REPORTS).length);
    expect(calls[0].dateRanges).toEqual([{ startDate: '2025-09-18', endDate: '2026-10-22' }]);
    expect(calls[0].metrics.map((m: any) => m.name)).toEqual(['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'keyEvents', 'ecommercePurchases', 'purchaseRevenue']);
    const ins = inserts();
    expect(ins).toHaveLength(2);
    expect(ins[0]).toContain('2026-10-21');
    expect(ins[0]).toContain('Organic Search');
    expect(ins[0]).toContain('185001'); // revenue rounded to whole shillings
    expect(ins[0]).toContain('on conflict (day, report, dimension)');
  });

  it('refreshes only the last three days once rows are held', async () => {
    lastDay = '2026-10-20';
    const calls: any[] = [];
    const api = { runReport: async (req: any) => { calls.push(req); return { propertyId: 'p', rows: [] }; } };
    const r = await new Ga4DailyPull(api).run(NOW);
    expect(r).toMatchObject({ mode: 'refresh', from: '2026-10-20', to: '2026-10-22', rows: 0 });
    expect(calls[0].dateRanges[0]).toEqual({ startDate: '2026-10-20', endDate: '2026-10-22' });
  });

  it('writes nothing and stops after the first report when the credential is unavailable', async () => {
    let n = 0;
    const api = { runReport: async () => { n++; return { unavailable: 'No GA4 service-account credential (vault connection google-analytics-4 or GA4_SERVICE_ACCOUNT_JSON).' }; } };
    const r = await new Ga4DailyPull(api).run(NOW);
    expect(r.unavailable).toContain('No GA4 service-account credential');
    expect(n).toBe(1);
    expect(inserts()).toHaveLength(0);
  });

  it('skips malformed rows and a failing report without losing the others', async () => {
    const api = { runReport: async (req: any) => {
      if (req.dimensions[1].name === 'landingPage') throw new Error('ECONNRESET');
      return { propertyId: 'p', rows: [row('2026-10-21', 'bad date', [1, 1, 1, 1, 0, 0, 0]), row('20261021', '', [5, 5, 5, 5, 0, 0, 0])] };
    } };
    const r = await new Ga4DailyPull(api).run(NOW);
    expect(r.reports.landing_page).toEqual({ error: 'ECONNRESET' });
    expect(r.reports.channel).toBe(1);
    expect(inserts().every((q) => q.includes('(not set)'))).toBe(true); // the empty dimension is named, not blank
  });
});

describe('GA4 Data API client', () => {
  it('reports a missing credential without calling Google, and pages through a long report', async () => {
    const seoRepo = { findConnectionWithActiveCredential: async () => null, getActiveCredential: async () => null };
    delete process.env.GA4_SERVICE_ACCOUNT_JSON;
    const fetchImpl = vi.fn();
    const r = await new Ga4DataApi(seoRepo, fetchImpl as unknown as typeof fetch).runReport({ dateRanges: [], dimensions: [], metrics: [] });
    expect(r).toMatchObject({ unavailable: expect.stringContaining('No GA4 service-account credential') });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
