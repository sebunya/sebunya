import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Microsoft Clarity server-to-server pull (0207): the Data Export API's answer is flattened into one row per
 * day/breakdown/value/metric/field, three calls a night with the bearer token, nothing without a token, and a
 * 429 stops the night instead of burning the rest of the ten-call budget.
 */
const executed: string[] = [];
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
const answer = (q: unknown) => { executed.push(sqlText(q)); return []; };
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({
  db: { execute: async (q: unknown) => answer(q), transaction: async (fn: (tx: unknown) => Promise<void>) => fn({ execute: async (q: unknown) => answer(q) }) },
}));
vi.mock('../../apps/api/src/infrastructure/logging/logger', () => ({ logger: { warn: () => undefined, info: () => undefined, error: () => undefined } }));

const { ClarityInsightsPull, flatten } = await import('../../apps/api/src/infrastructure/measurement/ClarityInsightsPull');

const SAMPLE = [
  { metricName: 'Traffic', information: [{ totalSessionCount: '9554', totalBotSessionCount: '8369', distantUserCount: '189733', PagesPerSessionPercentage: 1.0931 }] },
  { metricName: 'RageClickCount', information: [{ sessionsCount: '12', sessionsWithMetricPercentage: 0.13, subTotal: '14' }] },
];
const BY_URL = [
  { metricName: 'Traffic', information: [{ totalSessionCount: '40', URL: 'https://shopgoldplus.com/' }, { totalSessionCount: '9', URL: 'https://shopgoldplus.com/checkout' }] },
  { metricName: 'DeadClickCount', information: [{ sessionsCount: '3', URL: 'https://shopgoldplus.com/checkout' }] },
];
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
const NOW = new Date('2026-10-26T00:40:00Z'); // 03:40 Kampala

describe('Clarity insights pull', () => {
  beforeEach(() => { executed.length = 0; });

  it('flattens every numeric field under its metric; the breakdown column becomes the row key, name columns are skipped', () => {
    expect(flatten(SAMPLE as any, 'total')).toEqual([
      { breakdownValue: '', metric: 'Traffic', field: 'totalSessionCount', value: 9554 },
      { breakdownValue: '', metric: 'Traffic', field: 'totalBotSessionCount', value: 8369 },
      { breakdownValue: '', metric: 'Traffic', field: 'distantUserCount', value: 189733 },
      { breakdownValue: '', metric: 'Traffic', field: 'PagesPerSessionPercentage', value: 1.0931 },
      { breakdownValue: '', metric: 'RageClickCount', field: 'sessionsCount', value: 12 },
      { breakdownValue: '', metric: 'RageClickCount', field: 'sessionsWithMetricPercentage', value: 0.13 },
      { breakdownValue: '', metric: 'RageClickCount', field: 'subTotal', value: 14 },
    ]);
    const u = flatten(BY_URL as any, 'URL');
    expect(u).toContainEqual({ breakdownValue: 'https://shopgoldplus.com/checkout', metric: 'DeadClickCount', field: 'sessionsCount', value: 3 });
    expect(u.find((r) => r.field === 'URL')).toBeUndefined();
    expect(flatten([{ metricName: 'Browser', information: [{ Browser: 'Chrome', sessionsCount: 'x' }] }] as any, 'total')).toEqual([]);
  });

  it('makes three calls with the bearer token, files rows under the previous UTC day, and does nothing without a token', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok_test');
      return json(String(url).includes('dimension1=URL') ? BY_URL : String(url).includes('dimension1=Channel') ? [{ metricName: 'Traffic', information: [{ totalSessionCount: '30', Channel: 'Direct' }] }] : SAMPLE);
    });
    const r = await new ClarityInsightsPull('tok_test', fetchImpl as unknown as typeof fetch).run(NOW);
    expect(urls).toEqual([
      'https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1',
      'https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1&dimension1=URL',
      'https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1&dimension1=Channel',
    ]);
    expect(r).toEqual({ configured: true, day: '2026-10-25', rows: 11, calls: { total: 7, URL: 3, Channel: 1 } });
    const ins = executed.filter((q) => q.includes('insert into measurement.clarity_insights'));
    expect(ins).toHaveLength(11);
    expect(ins[0]).toContain('2026-10-25');
    expect(ins.some((q) => q.includes('https://shopgoldplus.com/checkout') && q.includes('DeadClickCount'))).toBe(true);
    executed.length = 0;
    expect(await new ClarityInsightsPull('', fetchImpl as unknown as typeof fetch).run(NOW)).toEqual({ configured: false, day: null, rows: 0, calls: {} });
    expect(executed).toHaveLength(0);
  });

  it('a 429 (daily export limit) stops the night; a refused call is reported per breakdown and writes nothing', async () => {
    const limited = vi.fn(async () => json({ message: 'Exceeded daily limit' }, 429));
    const r = await new ClarityInsightsPull('tok', limited as unknown as typeof fetch).run(NOW);
    expect(r.calls).toEqual({ total: { error: 'Clarity daily export limit reached (10 calls a day)' } });
    expect(limited).toHaveBeenCalledTimes(1);
    const refused = vi.fn(async () => json({}, 401));
    const r2 = await new ClarityInsightsPull('tok', refused as unknown as typeof fetch).run(NOW);
    expect(r2.calls).toEqual({ total: { error: 'Clarity answered HTTP 401' }, URL: { error: 'Clarity answered HTTP 401' }, Channel: { error: 'Clarity answered HTTP 401' } });
    expect(executed.filter((q) => q.includes('insert into'))).toHaveLength(0);
  });
});
