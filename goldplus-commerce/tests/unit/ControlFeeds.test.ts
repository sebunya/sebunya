import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The nightly control feeds (market dollar rate, Kampala rain) against canned HTTP answers: what gets written,
 * what is refused, and that a failed feed writes nothing and says why. The database is a recording fake.
 */
const executed: string[] = [];
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({
  db: {
    execute: async (q: unknown) => { executed.push(sqlText(q)); return sqlText(q).includes('count(*)') ? [{ n: 0 }] : []; },
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn({ execute: async (q: unknown) => { executed.push(sqlText(q)); return []; } }),
  },
}));
vi.mock('../../apps/api/src/infrastructure/logging/logger', () => ({ logger: { warn: () => undefined, info: () => undefined, error: () => undefined } }));

function sqlText(q: unknown): string {
  // drizzle sql`` chunks: StringChunk {value: string[]}, nested SQL {queryChunks}, or a bare parameter value.
  const chunks = (q as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks.map((c): string => {
    if (c === null || c === undefined) return 'null';
    if (typeof c !== 'object') return String(c);
    if (Array.isArray((c as { value?: unknown }).value)) return ((c as { value: string[] }).value).join('');
    if ((c as { queryChunks?: unknown[] }).queryChunks) return sqlText(c);
    return '';
  }).join('');
}

const { ControlFeeds } = await import('../../apps/api/src/infrastructure/measurement/ControlFeeds');

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('control feeds', () => {
  beforeEach(() => { executed.length = 0; });

  it('stores the market dollar rate dated by the feed day, without the margin, and the rain per day', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://open.er-api.com/')) return json({ result: 'success', time_last_update_unix: Date.UTC(2026, 9, 23) / 1000, rates: { UGX: 4126.431341 } });
      if (u.startsWith('https://archive-api.open-meteo.com/')) {
        expect(u).toContain('latitude=0.3476');
        expect(u).toContain('timezone=Africa%2FKampala');
        return json({ daily: { time: ['2026-10-20', '2026-10-21', '2026-10-22'], precipitation_sum: [2.6, null, 27.2] } });
      }
      throw new Error(`unexpected ${u}`);
    });
    const feeds = new ControlFeeds(fetchImpl as unknown as typeof fetch);
    const r = await feeds.run(new Date('2026-10-23T01:00:00Z'));
    expect(r.usd_ugx).toEqual({ day: '2026-10-23', rate: 4126.431341 });
    expect(r.rain_mm).toMatchObject({ days: 2, to: '2026-10-22' });
    const fx = executed.filter((q) => q.includes("'usd_ugx'") && q.includes('insert'));
    expect(fx).toHaveLength(1);
    expect(fx[0]).toContain("'feed'");
    expect(fx[0]).toContain("where measurement.control_series.source = 'feed'"); // never over a manual value
    expect(executed.filter((q) => q.includes("'rain_mm'") && q.includes('insert'))).toHaveLength(2); // the null day is left empty
  });

  it('refuses an unusable rate and a failed archive, writing nothing and saying why', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://open.er-api.com/')) return json({ result: 'success', rates: { UGX: 12 } });
      return json({ error: true }, 503);
    });
    const r = await new ControlFeeds(fetchImpl as unknown as typeof fetch).run(new Date('2026-10-23T01:00:00Z'));
    expect(r.usd_ugx).toMatchObject({ error: expect.stringContaining('no usable UGX rate') });
    expect(r.rain_mm).toMatchObject({ error: expect.stringContaining('HTTP 503') });
    expect(executed.filter((q) => q.includes('insert'))).toHaveLength(0);
  });

  it('a network failure in one feed does not stop the other', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).startsWith('https://open.er-api.com/')) throw new Error('ECONNRESET');
      return json({ daily: { time: ['2026-10-22'], precipitation_sum: [0] } });
    });
    const r = await new ControlFeeds(fetchImpl as unknown as typeof fetch).run(new Date('2026-10-23T01:00:00Z'));
    expect(r.usd_ugx).toEqual({ error: 'ECONNRESET' });
    expect(r.rain_mm).toMatchObject({ days: 1 });
  });
});
