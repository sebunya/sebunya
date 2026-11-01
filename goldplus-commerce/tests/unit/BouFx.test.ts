import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveUgxPerUsd } from '../../apps/api/src/domain/measurement/MeasurementConfig';
import { RecordBouFxReadingUseCase } from '../../apps/api/src/application/use-cases/measurement/RecordBouFxReadingUseCase';
import { parseUsdRow } from '../../scripts/bou-fx.mjs';
import { inBouWindow } from '../../apps/api/src/infrastructure/scheduler/MeasurementNightlyTicker';
import { fxCheck } from '../../apps/api/src/infrastructure/measurement/ControlFeeds';

/**
 * The Bank of Uganda dollar rate (2026-10-24): read off bou.or.ug at 1 pm by scripts/bou-fx.mjs, posted to
 * /internal/fx/bou, kept as control usd_ugx_bou, and preferred over the open market feed while fresh.
 */
const executed: string[] = [];
let canned: Array<{ match: string; rows: any[] }> = [];
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
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({ db: { execute: async (q: unknown) => { const t = sqlText(q); executed.push(t); return canned.find((c) => t.includes(c.match))?.rows ?? []; } } }));
vi.mock('../../apps/api/src/infrastructure/logging/logger', () => ({ logger: { warn: () => undefined, info: () => undefined, error: () => undefined } }));
const { ControlFeeds } = await import('../../apps/api/src/infrastructure/measurement/ControlFeeds');

const EXPORT = `.,Currency,Indicator,Rate\r\n.,Euro/U.S. Dollar,Cross Rates,1.1215\r\n.,Euro/U.S. Dollar,Buying Rates,4820.685534\r\n.,U.S. Dollar/Uganda Shillings (UGX),Cross Rates,4303.81\r\n.,U.S. Dollar/Uganda Shillings (UGX),Buying Rates,4298.81\r\n.,U.S. Dollar/Uganda Shillings (UGX),Selling Rates,4308.81\r\n`;

describe('Bank of Uganda dollar rate', () => {
  beforeEach(() => { executed.length = 0; canned = []; });

  it('reads mid, buying and selling off the Power BI export and ignores every other currency', () => {
    expect(parseUsdRow(EXPORT)).toEqual({ mid: 4303.81, buying: 4298.81, selling: 4308.81 });
    expect(parseUsdRow('.,Currency,Indicator,Rate\n.,Euro/U.S. Dollar,Cross Rates,1.12')).toEqual({ mid: null, buying: null, selling: null });
    expect(parseUsdRow('.,U.S. Dollar/Uganda Shillings (UGX),Buying Rates,4000\n.,U.S. Dollar/Uganda Shillings (UGX),Selling Rates,4010').mid).toBe(4005);
  });

  it('the use case keeps a plausible reading for a real recent day and refuses nonsense', async () => {
    const stored: unknown[] = [];
    const uc = new RecordBouFxReadingUseCase({ recordBou: async (r) => { stored.push(r); } });
    const today = new Date().toISOString().slice(0, 10);
    expect(await uc.execute({ day: today, mid: 4303.81, buying: 4298.81, selling: 4308.81 })).toEqual({ ok: true, day: today, mid: 4308.81 });
    expect(stored[0]).toMatchObject({ day: today, mid: 4308.81, buying: 4298.81, selling: 4308.81, note: expect.stringContaining('Bank of Uganda selling rate') }); // the selling rate is what we pay
    expect((await uc.execute({ day: today, mid: 43 })).ok).toBe(false);
    expect((await uc.execute({ day: '2020-01-01', mid: 4300 })).ok).toBe(false);
    expect((await uc.execute({ day: 'today', mid: 4300 })).ok).toBe(false);
    expect((await uc.execute({ day: today, mid: 4300, buying: 4400, selling: 4200 })).ok).toBe(false); // sides the wrong way round
    expect(stored).toHaveLength(1);
  });

  it('the rate in use is the higher of the market quote and BoU selling + margin; each covers the other; the detail names both', async () => {
    const feeds = new ControlFeeds(vi.fn() as unknown as typeof fetch, '');
    canned = [{ match: "control_key = 'usd_ugx_bou'", rows: [{ day: '2026-10-22', value: '4214.76' }] }, { match: "control_key = 'usd_ugx' and source = 'feed'", rows: [{ day: '2026-10-24', value: '4419.95', note: 'allratestoday.com market quote (retail level, no margin added); quoted 2026-10-24T10:01:01.000Z' }] }];
    const both = await feeds.latestFx();
    expect(both).toEqual({ day: '2026-10-24', ugxPerUsd: 4419.95, source: 'market', cover: { day: '2026-10-22', ugxPerUsd: 4214.76 } });
    expect(executed[0]).toContain('current_date - 5');
    // the market quote already sits at bank level: no margin; BoU selling + 200 is the cover, and the higher wins
    expect(resolveUgxPerUsd({ usd_ugx_margin: '200' }, both, '2026-10-24')).toEqual({ rate: 4420, basis: 'feed', detail: 'market 4420 on 2026-10-24 (retail quote, no margin); cover: Bank of Uganda selling 4215 on 2026-10-22 + 200 margin = 4415' });
    expect(resolveUgxPerUsd({ usd_ugx_margin: '300' }, both, '2026-10-24')).toMatchObject({ rate: 4515, detail: expect.stringContaining('Bank of Uganda selling 4215 on 2026-10-22 + 300 margin; cover: market 4420') });
    expect(resolveUgxPerUsd({ usd_ugx_margin: '200' }, { ...both!, day: '2026-10-10' }, '2026-10-24')).toMatchObject({ rate: 4415, detail: 'Bank of Uganda selling 4215 on 2026-10-22 + 200 margin' }); // stale market quote: BoU covers
    expect(resolveUgxPerUsd({ usd_ugx_margin: '200' }, { ...both!, cover: { day: '2026-10-15', ugxPerUsd: 4000 } }, '2026-10-24')).toMatchObject({ rate: 4420, detail: 'market 4420 on 2026-10-24 (retail quote, no margin)' }); // stale BoU: market alone
    canned = [{ match: "control_key = 'usd_ugx_bou'", rows: [{ day: '2026-10-24', value: '4303.81' }] }, { match: "control_key = 'usd_ugx' and source = 'feed'", rows: [] }];
    expect(await feeds.latestFx()).toEqual({ day: '2026-10-24', ugxPerUsd: 4303.81, source: 'bou' });
    expect(resolveUgxPerUsd({ usd_ugx_margin: '200' }, { day: '2026-10-24', ugxPerUsd: 4303.81, source: 'bou' }, '2026-10-24')).toEqual({ rate: 4504, basis: 'feed', detail: 'Bank of Uganda selling 4304 on 2026-10-24 + 200 margin' });
    canned = [{ match: "control_key = 'usd_ugx' and source = 'feed'", rows: [{ day: '2026-10-24', value: '4166.17', note: 'open.er-api.com, market rate without margin' }] }];
    expect(await feeds.latestFx()).toEqual({ day: '2026-10-24', ugxPerUsd: 4166.17, source: 'feed' });
    expect(resolveUgxPerUsd({}, { day: '2026-10-24', ugxPerUsd: 4166.17, source: 'feed' }, '2026-10-24').detail).toBe('market 4166 on 2026-10-24 + 100 margin'); // the open interbank feed still gets the margin
    expect(resolveUgxPerUsd({ ugx_per_usd: '4000' }, { day: '2026-10-24', ugxPerUsd: 4303.81, source: 'bou' }, '2026-10-24')).toMatchObject({ rate: 4000, basis: 'manual' }); // a hand-set rate still wins
  });

  it('recording writes the bou row and never overwrites a row of another source', async () => {
    await new ControlFeeds().recordBou({ day: '2026-10-24', mid: 4303.81, buying: 4298.81, selling: 4308.81, note: 'n' });
    const w = executed.find((q) => q.includes('insert into measurement.control_series'));
    expect(w).toContain("'usd_ugx_bou'");
    expect(w).toContain("'bou'");
    expect(w).toContain("where measurement.control_series.source = 'bou'");
  });

  it('the api fetches the BoU table from the AllRatesToday mirror with the key, keeps the USD selling rate dated by BoU, and refuses a stale or wrong answer', async () => {
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
    const usd = (t: string, v: number) => ({ base: 'USD', quote: 'UGX', type: t, value: v });
    const good = { bank: 'bou', rate_date: '2026-10-22', rates: [{ base: 'AED', quote: 'UGX', type: 'sell', value: 1147 }, usd('buy', 4204.76), usd('reference', 4209.76), usd('sell', 4214.76)] };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe('https://allratestoday.com/api/v1/central-bank/bou/latest');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer art_live_test');
      return json(good);
    });
    const r = await new ControlFeeds(fetchImpl as unknown as typeof fetch, 'art_live_test').bouSafe(new Date('2026-10-24T10:00:00Z'));
    expect(r).toEqual({ day: '2026-10-22', rate: 4214.76, ageDays: 2 }); // selling, not mid: we buy dollars
    const w = executed.find((q) => q.includes('insert into measurement.control_series'));
    expect(w).toContain("'usd_ugx_bou'");
    expect(w).toContain('2026-10-22');
    expect(w).toContain('4214.76');
    expect(w).toContain('mid 4209.76; buying 4204.76');
    executed.length = 0;
    expect(await new ControlFeeds(fetchImpl as unknown as typeof fetch, '').bouSafe()).toEqual({ skipped: 'ALLRATES_API_KEY is not set: the Bank of Uganda rate is not fetched' });
    expect(await new ControlFeeds(vi.fn(async () => json({ ...good, rates: [usd('reference', 4209.76)] })) as unknown as typeof fetch, 'k').bouSafe(new Date('2026-10-24T10:00:00Z'))).toMatchObject({ rate: 4209.76 }); // mid only if no selling rate
    expect(await new ControlFeeds(vi.fn(async () => json({ ...good, rates: [{ base: 'AED', quote: 'UGX', type: 'sell', value: 1147 }] })) as unknown as typeof fetch, 'k').bouSafe()).toMatchObject({ error: expect.stringContaining('no usable BoU USD/UGX') });
    expect(await new ControlFeeds(vi.fn(async () => json({ ...good, rate_date: '2026-10-10' })) as unknown as typeof fetch, 'k').bouSafe(new Date('2026-10-24T10:00:00Z'))).toMatchObject({ error: expect.stringContaining('days old') });
    // The refusal says what the provider said (status, then the body), so a wrong key can be told from a blocked server.
    const refused = { ok: false, status: 401, redirected: false, url: '', headers: { get: () => 'application/json' }, text: async () => '{"error":"invalid api key"}' } as unknown as Response;
    expect(await new ControlFeeds(vi.fn(async () => refused) as unknown as typeof fetch, 'k').bouSafe()).toEqual({ error: 'allratestoday.com Bank of Uganda table answered HTTP 401 (application/json): {"error":"invalid api key"}' });
    // A selling rate with an extra digit is out of range and dropped: the mid is kept, never the impossible value.
    expect(await new ControlFeeds(vi.fn(async () => json({ ...good, rates: [usd('reference', 4303.81), usd('sell', 43088.1)] })) as unknown as typeof fetch, 'k').bouSafe(new Date('2026-10-24T10:00:00Z'))).toMatchObject({ rate: 4303.81 });
    // In range but not believable (under "the higher of" it would win for five days): refused.
    expect(await new ControlFeeds(vi.fn(async () => json({ ...good, rates: [usd('reference', 4303.81), usd('sell', 4600)] })) as unknown as typeof fetch, 'k').bouSafe(new Date('2026-10-24T10:00:00Z'))).toMatchObject({ error: expect.stringContaining('selling more than 3% above mid') });
    expect(executed.filter((q) => q.includes('insert into') && q.includes('2026-10-10'))).toHaveLength(0);
  });

  it('with the key the market quote comes from allratestoday.com, dated by the Kampala day of its own timestamp; without it the open feed is used', async () => {
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://allratestoday.com/api/v1/rates?source=USD&target=UGX');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer art_live_test');
      return json([{ rate: 4419.95, source: 'USD', target: 'UGX', time: '2026-10-24T22:30:00+00:00' }]);
    });
    executed.length = 0;
    expect(await new ControlFeeds(fetchImpl as unknown as typeof fetch, 'art_live_test').fxSafe(new Date('2026-10-24T22:40:00Z'))).toEqual({ day: '2026-10-25', rate: 4419.95 }); // 22:30 UTC is already Sunday in Kampala
    const w = executed.find((q) => q.includes('insert into measurement.control_series'));
    expect(w).toContain("'usd_ugx'");
    expect(w).toContain('allratestoday.com market quote (retail level, no margin added)');
    // The market quote failing (a rejected key, a changed answer) no longer leaves the rate to age into the 3,800
    // default: the open feed stands in, says so, and never overwrites a good quote of the same day.
    const both = vi.fn(async (url: string | URL | Request) => String(url).startsWith('https://open.er-api.com')
      ? json({ result: 'success', rates: { UGX: 4166.17 }, time_last_update_unix: 1792972800 })
      : json([{ rate: 0.89, source: 'USD', target: 'EUR' }]));
    executed.length = 0;
    const fell = await new ControlFeeds(both as unknown as typeof fetch, 'k').fxSafe();
    expect(fell).toMatchObject({ rate: 4166.17, fallback: expect.stringContaining('no usable USD/UGX market quote') });
    expect(executed.find((q) => q.includes("'open.er-api.com, market rate without margin'"))).toMatch(/not like 'allratestoday\.com%'/);
    expect(await new ControlFeeds(vi.fn(async () => json({}, 500)) as unknown as typeof fetch, 'k').fxSafe()).toMatchObject({ error: expect.stringContaining('open.er-api.com answered HTTP 500') });
    const open = vi.fn(async (url: string | URL | Request) => { expect(String(url)).toBe('https://open.er-api.com/v6/latest/USD'); return json({ result: 'success', rates: { UGX: 4166.17 }, time_last_update_unix: 1792972800 }); });
    expect(await new ControlFeeds(open as unknown as typeof fetch, '').fxSafe()).toMatchObject({ rate: 4166.17 });
  });

  it('the market quote is checked against BoU selling: a few percent above is sane, below or far above is flagged', () => {
    expect(fxCheck({ usd_ugx: { day: 'd', rate: 4419.95 }, usd_ugx_bou: { day: 'd', rate: 4214.76, ageDays: 2 } })).toEqual({ market: 4419.95, bou: 4214.76, gapPct: 4.9, ok: true });
    expect(fxCheck({ usd_ugx: { day: 'd', rate: 4100 }, usd_ugx_bou: { day: 'd', rate: 4214.76, ageDays: 2 } })?.ok).toBe(false);
    expect(fxCheck({ usd_ugx: { day: 'd', rate: 4800 }, usd_ugx_bou: { day: 'd', rate: 4214.76, ageDays: 2 } })?.ok).toBe(false);
    expect(fxCheck({ usd_ugx: { error: 'down' }, usd_ugx_bou: { day: 'd', rate: 4214.76, ageDays: 2 } })).toBeNull();
  });

  it('the 1 pm tick runs only in the 13:00 Kampala hour', () => {
    expect(inBouWindow(new Date('2026-10-24T10:00:00Z'))).toBe(true);
    expect(inBouWindow(new Date('2026-10-24T10:59:00Z'))).toBe(true);
    expect(inBouWindow(new Date('2026-10-24T11:00:00Z'))).toBe(false);
    expect(inBouWindow(new Date('2026-10-24T04:00:00Z'))).toBe(false);
  });

  it('one believability rule for both writers: in range, in order, selling within 3% of mid', async () => {
    const { bouReadingProblem } = await import('../../apps/api/src/domain/measurement/BouReading');
    expect(bouReadingProblem({ mid: 4303.81, buying: 4298.81, selling: 4308.81 })).toBeNull();
    expect(bouReadingProblem({ mid: 4303.81, buying: 4298.81, selling: 43088.1 })).toMatch(/outside/);
    expect(bouReadingProblem({ mid: 4303.81, buying: null, selling: 4600 })).toMatch(/3% above mid/);
    expect(bouReadingProblem({ mid: 4303.81, buying: 4400, selling: 4308.81 })).toMatch(/buying above/);
    expect(bouReadingProblem({ mid: null, buying: null, selling: null })).toMatch(/neither/);
  });
});

