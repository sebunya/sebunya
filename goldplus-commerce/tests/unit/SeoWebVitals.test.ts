import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  rateMetric,
  toVitalsView,
  splitBySource,
  measurementCoverage,
  SyncWebVitalsUseCase,
  WEB_VITAL_SOURCES,
  WEB_VITAL_THRESHOLDS,
  type WebVitalMeasurement,
  type WebVitalsProviderPort,
} from '../../apps/api/src/application/use-cases/seo-growth/WebVitalsUseCases';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** A store that records what would have been written, so nothing needs a DB. */
const fakeStore = () => {
  const rows: WebVitalMeasurement[] = [];
  return { rows, upsertMeasurement: async (m: WebVitalMeasurement) => { rows.push(m); return m; } };
};

const provider = (overrides: Partial<WebVitalsProviderPort> = {}): WebVitalsProviderPort => ({
  fetchPageSpeed: async () => ({
    lcpMs: 2100, inpMs: null, cls: 0.05, ttfbMs: 400, fcpMs: 1200, performanceScore: 91,
  }),
  fetchCrux: async () => ({
    lcpMs: 3400, inpMs: 260, cls: 0.12, ttfbMs: 900, fcpMs: 2000,
    distributions: { largest_contentful_paint: { histogram: [] } }, sampleSize: 1200,
  }),
  ...overrides,
});

// ── Ratings ─────────────────────────────────────────────────────────────────

describe('a metric with no reading is NOT_MEASURED, never good', () => {
  it.each([null, undefined, '', 'n/a', NaN, -1])('treats %p as NOT_MEASURED', (v) => {
    expect(rateMetric('LCP', v)).toBe('NOT_MEASURED');
  });

  it('never coerces a missing value to zero and calls it GOOD', () => {
    expect(rateMetric('CLS', null)).not.toBe('GOOD');
    expect(rateMetric('CLS', 0)).toBe('GOOD');
  });

  it('applies Google published thresholds at the boundaries', () => {
    expect(rateMetric('LCP', WEB_VITAL_THRESHOLDS.LCP.good)).toBe('GOOD');
    expect(rateMetric('LCP', WEB_VITAL_THRESHOLDS.LCP.good + 1)).toBe('NEEDS_IMPROVEMENT');
    expect(rateMetric('LCP', WEB_VITAL_THRESHOLDS.LCP.poor)).toBe('NEEDS_IMPROVEMENT');
    expect(rateMetric('LCP', WEB_VITAL_THRESHOLDS.LCP.poor + 1)).toBe('POOR');
    expect(rateMetric('CLS', 0.1)).toBe('GOOD');
    expect(rateMetric('CLS', 0.3)).toBe('POOR');
  });
});

// ── Views ───────────────────────────────────────────────────────────────────

describe('a URL with no row renders as NOT_MEASURED with a reason', () => {
  it('marks every metric NOT_MEASURED and states why for field data', () => {
    const view = toVitalsView('https://x/', 'CRUX_FIELD', 'MOBILE', null);
    expect(view.measured).toBe(false);
    expect(Object.values(view.metrics).every((m) => m.rating === 'NOT_MEASURED' && m.value === null)).toBe(true);
    expect(view.performanceScore).toBeNull();
    expect(view.notMeasuredReason).toMatch(/field data/i);
  });

  it('gives a different, honest reason for a missing lab run', () => {
    const view = toVitalsView('https://x/', 'PAGESPEED_LAB', 'MOBILE', null);
    expect(view.notMeasuredReason).toMatch(/lab run/i);
  });

  it('renders a real lab row with its score, source, form factor and date', () => {
    const view = toVitalsView('https://x/', 'PAGESPEED_LAB', 'DESKTOP', {
      lcp_ms: '2100', cls: '0.05', ttfb_ms: '400', fcp_ms: '1200',
      performance_score: '91', collected_at: '2026-08-13T10:00:00Z', collection_date: '2026-08-13',
    });
    expect(view.measured).toBe(true);
    expect(view.source).toBe('PAGESPEED_LAB');
    expect(view.formFactor).toBe('DESKTOP');
    expect(view.collectionDate).toBe('2026-08-13');
    expect(view.metrics.LCP).toEqual({ value: 2100, rating: 'GOOD' });
    expect(view.metrics.INP.rating).toBe('NOT_MEASURED');
    expect(view.performanceScore).toBe(91);
  });

  it('refuses to surface a performance score on a field row even if one is present', () => {
    const view = toVitalsView('https://x/', 'CRUX_FIELD', 'MOBILE', {
      lcp_ms: '3400', performance_score: '77', collection_date: '2026-08-13',
    });
    expect(view.performanceScore).toBeNull();
  });
});

// ── Lab and field never blend ───────────────────────────────────────────────

describe('lab and field are never averaged or blended', () => {
  const rows = [
    { url: 'https://x/', source: 'PAGESPEED_LAB', lcp_ms: '1000' },
    { url: 'https://x/', source: 'CRUX_FIELD', lcp_ms: '5000' },
  ];

  it('splits into two buckets that keep their own numbers', () => {
    const { lab, field } = splitBySource(rows);
    expect(lab).toHaveLength(1);
    expect(field).toHaveLength(1);
    expect(lab[0].lcp_ms).toBe('1000');
    expect(field[0].lcp_ms).toBe('5000');
  });

  it('exports no function that merges the two sources', () => {
    const src = read('apps/api/src/application/use-cases/seo-growth/WebVitalsUseCases.ts');
    expect(src).not.toMatch(/export function (average|blend|combine|composite|healthScore)/);
  });

  it('the admin page shows no fabricated composite health number', () => {
    const page = read('apps/web/src/pages/admin/seo/web-vitals.astro');
    expect(page).not.toMatch(/health\s*(score|index)/i);
    expect(page).toContain('never averaged');
    expect(page).toContain('NOT MEASURED');
  });

  it('coverage reports lab and field presence separately', () => {
    const cov = measurementCoverage(['https://x/', 'https://y/'], rows);
    expect(cov).toEqual([
      { url: 'https://x/', lab: true, field: true },
      { url: 'https://y/', lab: false, field: false },
    ]);
  });
});

// ── Sync ────────────────────────────────────────────────────────────────────

describe('SyncWebVitalsUseCase pulls through an injected port', () => {
  it('stores one lab row and one field row, separately', async () => {
    const store = fakeStore();
    const result = await new SyncWebVitalsUseCase(provider(), store)
      .execute({ urls: ['https://x/'], formFactors: ['MOBILE'] });
    expect(result.stored).toBe(2);
    expect(result.failed).toBe(0);
    expect(store.rows.map((r) => r.source).sort()).toEqual(['CRUX_FIELD', 'PAGESPEED_LAB']);
  });

  it('never writes a performance score on a field row', async () => {
    const store = fakeStore();
    await new SyncWebVitalsUseCase(
      // A provider that wrongly offers a score must not get one through.
      provider({ fetchCrux: async () => ({
        lcpMs: 3400, inpMs: 260, cls: 0.12, ttfbMs: 900, fcpMs: 2000,
        distributions: null, sampleSize: 10, performanceScore: 55,
      } as never) }),
      store,
    ).execute({ urls: ['https://x/'], sources: ['CRUX_FIELD'] });
    const field = store.rows.find((r) => r.source === 'CRUX_FIELD');
    expect(field?.performanceScore).toBeNull();
  });

  it('records NO_DATA and writes nothing when CrUX has too few samples', async () => {
    const store = fakeStore();
    const result = await new SyncWebVitalsUseCase(provider({ fetchCrux: async () => null }), store)
      .execute({ urls: ['https://x/'] });
    expect(result.noData).toBe(1);
    expect(store.rows.some((r) => r.source === 'CRUX_FIELD')).toBe(false);
    const outcome = result.outcomes.find((o) => o.source === 'CRUX_FIELD');
    expect(outcome?.state).toBe('NO_DATA');
    expect(outcome?.message).toMatch(/NOT_MEASURED/);
  });

  it('records a provider failure as FAILED without inventing a reading', async () => {
    const store = fakeStore();
    const result = await new SyncWebVitalsUseCase(
      provider({ fetchPageSpeed: async () => { throw new Error('HTTP 429'); } }),
      store,
    ).execute({ urls: ['https://x/'], sources: ['PAGESPEED_LAB'] });
    expect(result.failed).toBe(1);
    expect(result.stored).toBe(0);
    expect(store.rows).toHaveLength(0);
    expect(result.outcomes[0].message).toContain('HTTP 429');
  });

  it('one failing URL does not abort the rest of the batch', async () => {
    const store = fakeStore();
    const result = await new SyncWebVitalsUseCase(
      provider({ fetchPageSpeed: async (url) => {
        if (url === 'https://bad/') throw new Error('boom');
        return { lcpMs: 1, inpMs: null, cls: 0, ttfbMs: 1, fcpMs: 1, performanceScore: 100 };
      } }),
      store,
    ).execute({ urls: ['https://bad/', 'https://good/'], sources: ['PAGESPEED_LAB'] });
    expect(result.failed).toBe(1);
    expect(result.stored).toBe(1);
  });

  it('covers both form factors when asked, as separate rows', async () => {
    const store = fakeStore();
    const result = await new SyncWebVitalsUseCase(provider(), store)
      .execute({ urls: ['https://x/'], formFactors: ['MOBILE', 'DESKTOP'], sources: ['PAGESPEED_LAB'] });
    expect(result.stored).toBe(2);
    expect(store.rows.map((r) => r.formFactor).sort()).toEqual(['DESKTOP', 'MOBILE']);
  });

  it('stamps a collection date on every row', async () => {
    const store = fakeStore();
    await new SyncWebVitalsUseCase(provider(), store)
      .execute({ urls: ['https://x/'], collectionDate: '2026-08-13' });
    expect(store.rows.every((r) => r.collectionDate === '2026-08-13')).toBe(true);
  });

  it('refuses an empty URL list rather than syncing nothing silently', async () => {
    await expect(new SyncWebVitalsUseCase(provider(), fakeStore()).execute({ urls: [] }))
      .rejects.toThrow(/at least one URL/i);
  });
});

// ── Wiring ──────────────────────────────────────────────────────────────────

describe('the vitals module is wired honestly', () => {
  const route = read('apps/api/src/interfaces/http/routes/admin/seo-vitals.ts');

  it('stores only the two sources the CHECK constraint allows', () => {
    expect([...WEB_VITAL_SOURCES]).toEqual(['PAGESPEED_LAB', 'CRUX_FIELD']);
  });

  it('guards every handler with a literal requirePermissions', () => {
    const handlers = route.match(/routes\.(get|post|patch|delete)\('/g) ?? [];
    const guards = route.match(/requirePermissions\(\[/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    expect(guards.length).toBe(handlers.length);
  });

  it('audits the sync mutation', () => {
    expect(route).toMatch(/await audit\(c, 'SEO_WEB_VITALS_SYNCED'/);
  });

  it('refuses to sync without a Google API key instead of storing placeholders', () => {
    expect(route).toContain('CONFIGURATION_ERROR');
    expect(route).toMatch(/no measurement has been invented/i);
  });

  it('does not rewrite the existing integration adapters', () => {
    const adapters = read('apps/api/src/infrastructure/seo/adapters/SeoIntegrationAdapters.ts');
    expect(adapters).not.toContain('seo_web_vitals');
    expect(adapters).not.toContain('SyncWebVitalsUseCase');
  });
});
