/**
 * Core Web Vitals (migration 0120) — measured, never scored by us.
 *
 * Two sources answer two different questions and are stored, reported and read
 * separately. They are NEVER averaged, blended or combined into a single
 * "health" number:
 *
 *  * PAGESPEED_LAB — one synthetic run on Google's hardware. Reproducible,
 *    diagnostic, and carries a Lighthouse performance score.
 *  * CRUX_FIELD — what real Chrome users experienced over a 28-day window.
 *    It is a DISTRIBUTION, not a score; a field row therefore never carries a
 *    performance_score (the CHECK constraint forbids it, and so does honesty).
 *
 * A URL with no row is NOT_MEASURED. NOT_MEASURED is its own state: it is not
 * zero, not "good", and never rendered green.
 *
 * The Google APIs are reached through a small injected port so the sync logic
 * is unit-testable against a fake without touching the network or the existing
 * SeoIntegrationAdapters (which own connection testing only).
 */

export const WEB_VITAL_SOURCES = ['PAGESPEED_LAB', 'CRUX_FIELD'] as const;
export type WebVitalSource = (typeof WEB_VITAL_SOURCES)[number];

export const WEB_VITAL_FORM_FACTORS = ['MOBILE', 'DESKTOP', 'ALL'] as const;
export type WebVitalFormFactor = (typeof WEB_VITAL_FORM_FACTORS)[number];

/** NOT_MEASURED is first-class: the absence of data is a reportable state. */
export const WEB_VITAL_RATINGS = ['GOOD', 'NEEDS_IMPROVEMENT', 'POOR', 'NOT_MEASURED'] as const;
export type WebVitalRating = (typeof WEB_VITAL_RATINGS)[number];

export type WebVitalMetric = 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP';

/** Google's published Core Web Vitals thresholds. We apply them; we don't invent them. */
export const WEB_VITAL_THRESHOLDS: Record<WebVitalMetric, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  TTFB: { good: 800, poor: 1800 },
  FCP: { good: 1800, poor: 3000 },
};

/**
 * Rate one metric. null/undefined/'' mean the metric was not measured — they
 * are NOT coerced to 0, which would fabricate a perfect score.
 */
export function rateMetric(metric: WebVitalMetric, value: unknown): WebVitalRating {
  if (value === null || value === undefined || value === '') return 'NOT_MEASURED';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 'NOT_MEASURED';
  const t = WEB_VITAL_THRESHOLDS[metric];
  if (n <= t.good) return 'GOOD';
  if (n <= t.poor) return 'NEEDS_IMPROVEMENT';
  return 'POOR';
}

export interface WebVitalMeasurement {
  url: string;
  source: WebVitalSource;
  formFactor: WebVitalFormFactor;
  collectionDate: string;
  collectedAt?: string | null;
  lcpMs?: number | null;
  inpMs?: number | null;
  cls?: number | null;
  ttfbMs?: number | null;
  fcpMs?: number | null;
  performanceScore?: number | null;
  distributions?: Record<string, unknown> | null;
  sampleSize?: number | null;
  connectionId?: string | null;
  raw?: Record<string, unknown> | null;
}

/** What the admin page renders for one URL/source/form-factor cell. */
export interface WebVitalsView {
  url: string;
  source: WebVitalSource;
  formFactor: WebVitalFormFactor;
  measured: boolean;
  collectedAt: string | null;
  collectionDate: string | null;
  metrics: Record<WebVitalMetric, { value: number | null; rating: WebVitalRating }>;
  performanceScore: number | null;
  sampleSize: number | null;
  /** Why there is nothing to show, when there is nothing to show. */
  notMeasuredReason: string | null;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Build the view for one URL/source/form factor. `row` may be undefined —
 * that is the NOT_MEASURED case, and it is rendered as such rather than
 * omitted or defaulted.
 */
export function toVitalsView(
  url: string,
  source: WebVitalSource,
  formFactor: WebVitalFormFactor,
  row?: Record<string, unknown> | null,
): WebVitalsView {
  const metricOf = (metric: WebVitalMetric, raw: unknown) => {
    const value = numOrNull(raw);
    return { value, rating: rateMetric(metric, value) };
  };
  if (!row) {
    return {
      url,
      source,
      formFactor,
      measured: false,
      collectedAt: null,
      collectionDate: null,
      metrics: {
        LCP: { value: null, rating: 'NOT_MEASURED' },
        INP: { value: null, rating: 'NOT_MEASURED' },
        CLS: { value: null, rating: 'NOT_MEASURED' },
        TTFB: { value: null, rating: 'NOT_MEASURED' },
        FCP: { value: null, rating: 'NOT_MEASURED' },
      },
      performanceScore: null,
      sampleSize: null,
      notMeasuredReason:
        source === 'CRUX_FIELD'
          ? 'No field data. Either this URL has never been synced, or CrUX has too few real-user samples to report it.'
          : 'No lab run recorded for this URL and form factor.',
    };
  }
  const r = row as Record<string, unknown>;
  const collectedAt = r.collected_at ?? r.collectedAt ?? null;
  const collectionDate = r.collection_date ?? r.collectionDate ?? null;
  return {
    url,
    source,
    formFactor,
    measured: true,
    collectedAt: collectedAt === null ? null : String(collectedAt),
    collectionDate: collectionDate === null ? null : String(collectionDate),
    metrics: {
      LCP: metricOf('LCP', r.lcp_ms ?? r.lcpMs),
      INP: metricOf('INP', r.inp_ms ?? r.inpMs),
      CLS: metricOf('CLS', r.cls),
      TTFB: metricOf('TTFB', r.ttfb_ms ?? r.ttfbMs),
      FCP: metricOf('FCP', r.fcp_ms ?? r.fcpMs),
    },
    // Field data has no score. Even if a row somehow carried one, we refuse to
    // present it, because CrUX does not produce one.
    performanceScore: source === 'PAGESPEED_LAB' ? numOrNull(r.performance_score ?? r.performanceScore) : null,
    sampleSize: numOrNull(r.sample_size ?? r.sampleSize),
    notMeasuredReason: null,
  };
}

/**
 * Group measurements for display. Lab and field stay in separate buckets —
 * there is deliberately no function here that merges them.
 */
export function splitBySource(rows: Record<string, unknown>[]): {
  lab: Record<string, unknown>[];
  field: Record<string, unknown>[];
} {
  return {
    lab: rows.filter((r) => String(r.source) === 'PAGESPEED_LAB'),
    field: rows.filter((r) => String(r.source) === 'CRUX_FIELD'),
  };
}

/** Coverage is a count of what IS measured, never a quality verdict. */
export function measurementCoverage(
  urls: string[],
  rows: Record<string, unknown>[],
): { url: string; lab: boolean; field: boolean }[] {
  const key = (r: Record<string, unknown>) => `${String(r.url)}::${String(r.source)}`;
  const present = new Set(rows.map(key));
  return urls.map((url) => ({
    url,
    lab: present.has(`${url}::PAGESPEED_LAB`),
    field: present.has(`${url}::CRUX_FIELD`),
  }));
}

// ── The injected port ───────────────────────────────────────────────────────

export interface PageSpeedLabResult {
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  ttfbMs: number | null;
  fcpMs: number | null;
  performanceScore: number | null;
  raw?: Record<string, unknown> | null;
}

export interface CruxFieldResult {
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  ttfbMs: number | null;
  fcpMs: number | null;
  distributions: Record<string, unknown> | null;
  sampleSize: number | null;
  raw?: Record<string, unknown> | null;
}

/**
 * The only network surface of this use case. Implementations call the Google
 * PageSpeed Insights and CrUX APIs; unit tests supply a fake. A provider that
 * has no data for a URL returns null — it never invents a reading.
 */
export interface WebVitalsProviderPort {
  fetchPageSpeed(url: string, formFactor: 'MOBILE' | 'DESKTOP'): Promise<PageSpeedLabResult | null>;
  fetchCrux(url: string, formFactor: WebVitalFormFactor): Promise<CruxFieldResult | null>;
}

export interface WebVitalsStorePort {
  upsertMeasurement(measurement: WebVitalMeasurement): Promise<unknown>;
}

export interface SyncWebVitalsInput {
  urls: string[];
  formFactors?: ('MOBILE' | 'DESKTOP')[];
  sources?: WebVitalSource[];
  connectionId?: string | null;
  collectionDate?: string;
}

export interface SyncTargetOutcome {
  url: string;
  source: WebVitalSource;
  formFactor: WebVitalFormFactor;
  state: 'STORED' | 'NO_DATA' | 'FAILED';
  message?: string;
}

export interface SyncWebVitalsResult {
  requested: number;
  stored: number;
  noData: number;
  failed: number;
  collectionDate: string;
  outcomes: SyncTargetOutcome[];
}

const isoDate = (value?: string): string => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
};

/**
 * Pull vitals from PageSpeed (lab) and CrUX (field) and store each reading as
 * its own row. Nothing is averaged; a provider returning no data yields a
 * NO_DATA outcome and NO row, so the URL stays honestly NOT_MEASURED.
 */
export class SyncWebVitalsUseCase {
  constructor(
    private readonly provider: WebVitalsProviderPort,
    private readonly store: WebVitalsStorePort,
  ) {}

  async execute(input: SyncWebVitalsInput): Promise<SyncWebVitalsResult> {
    const urls = (Array.isArray(input.urls) ? input.urls : [])
      .map((u) => String(u ?? '').trim())
      .filter((u) => u !== '');
    if (urls.length === 0) {
      throw new Error('SyncWebVitalsUseCase requires at least one URL.');
    }
    const formFactors = (input.formFactors && input.formFactors.length > 0 ? input.formFactors : ['MOBILE'])
      .filter((f): f is 'MOBILE' | 'DESKTOP' => f === 'MOBILE' || f === 'DESKTOP');
    const sources = (input.sources && input.sources.length > 0 ? input.sources : [...WEB_VITAL_SOURCES])
      .filter((s): s is WebVitalSource => (WEB_VITAL_SOURCES as readonly string[]).includes(s));
    const collectionDate = isoDate(input.collectionDate);
    const connectionId = input.connectionId ?? null;

    const outcomes: SyncTargetOutcome[] = [];

    for (const url of urls) {
      for (const formFactor of formFactors) {
        if (sources.includes('PAGESPEED_LAB')) {
          outcomes.push(await this.syncLab(url, formFactor, collectionDate, connectionId));
        }
        if (sources.includes('CRUX_FIELD')) {
          outcomes.push(await this.syncField(url, formFactor, collectionDate, connectionId));
        }
      }
    }

    return {
      requested: outcomes.length,
      stored: outcomes.filter((o) => o.state === 'STORED').length,
      noData: outcomes.filter((o) => o.state === 'NO_DATA').length,
      failed: outcomes.filter((o) => o.state === 'FAILED').length,
      collectionDate,
      outcomes,
    };
  }

  private async syncLab(
    url: string,
    formFactor: 'MOBILE' | 'DESKTOP',
    collectionDate: string,
    connectionId: string | null,
  ): Promise<SyncTargetOutcome> {
    try {
      const result = await this.provider.fetchPageSpeed(url, formFactor);
      if (!result) {
        return { url, source: 'PAGESPEED_LAB', formFactor, state: 'NO_DATA', message: 'PageSpeed returned no lab result for this URL.' };
      }
      await this.store.upsertMeasurement({
        url,
        source: 'PAGESPEED_LAB',
        formFactor,
        collectionDate,
        lcpMs: numOrNull(result.lcpMs),
        inpMs: numOrNull(result.inpMs),
        cls: numOrNull(result.cls),
        ttfbMs: numOrNull(result.ttfbMs),
        fcpMs: numOrNull(result.fcpMs),
        performanceScore: numOrNull(result.performanceScore),
        distributions: null,
        sampleSize: null,
        connectionId,
        raw: result.raw ?? null,
      });
      return { url, source: 'PAGESPEED_LAB', formFactor, state: 'STORED' };
    } catch (err: any) {
      return { url, source: 'PAGESPEED_LAB', formFactor, state: 'FAILED', message: String(err?.message ?? err) };
    }
  }

  private async syncField(
    url: string,
    formFactor: 'MOBILE' | 'DESKTOP',
    collectionDate: string,
    connectionId: string | null,
  ): Promise<SyncTargetOutcome> {
    try {
      const result = await this.provider.fetchCrux(url, formFactor);
      if (!result) {
        return {
          url,
          source: 'CRUX_FIELD',
          formFactor,
          state: 'NO_DATA',
          message: 'CrUX has no field data for this URL — too few real-user samples. The URL stays NOT_MEASURED for field.',
        };
      }
      await this.store.upsertMeasurement({
        url,
        source: 'CRUX_FIELD',
        formFactor,
        collectionDate,
        lcpMs: numOrNull(result.lcpMs),
        inpMs: numOrNull(result.inpMs),
        cls: numOrNull(result.cls),
        ttfbMs: numOrNull(result.ttfbMs),
        fcpMs: numOrNull(result.fcpMs),
        // Field data has no performance score. The CHECK constraint forbids
        // one, and there is no honest way to compute it from a distribution.
        performanceScore: null,
        distributions: result.distributions ?? null,
        sampleSize: numOrNull(result.sampleSize),
        connectionId,
        raw: result.raw ?? null,
      });
      return { url, source: 'CRUX_FIELD', formFactor, state: 'STORED' };
    } catch (err: any) {
      return { url, source: 'CRUX_FIELD', formFactor, state: 'FAILED', message: String(err?.message ?? err) };
    }
  }
}

// ── The live Google implementation of the port ──────────────────────────────

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

const audit = (lh: any, id: string): number | null => {
  const value = lh?.audits?.[id]?.numericValue;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const cruxP75 = (metric: any): number | null => {
  const value = metric?.percentiles?.p75;
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Real PageSpeed Insights + CrUX access. Both are read-only, key-authenticated
 * Google endpoints. A 404 from CrUX means "not enough samples", which is
 * NO DATA — a distinct, honest answer, not an error.
 */
export class GoogleWebVitalsProvider implements WebVitalsProviderPort {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchPageSpeed(url: string, formFactor: 'MOBILE' | 'DESKTOP'): Promise<PageSpeedLabResult | null> {
    const strategy = formFactor === 'DESKTOP' ? 'desktop' : 'mobile';
    const endpoint = `${PSI_ENDPOINT}?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance&key=${encodeURIComponent(this.apiKey)}`;
    const res = await this.fetchImpl(endpoint);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`PageSpeed Insights returned HTTP ${res.status} for ${url}.`);
    const body: any = await res.json();
    const lh = body?.lighthouseResult;
    if (!lh) return null;
    const score = lh?.categories?.performance?.score;
    return {
      lcpMs: audit(lh, 'largest-contentful-paint'),
      // Lighthouse reports TBT/max potential FID, not INP. INP is a field
      // metric; a lab run does not produce one, so it stays null.
      inpMs: null,
      cls: audit(lh, 'cumulative-layout-shift'),
      ttfbMs: audit(lh, 'server-response-time'),
      fcpMs: audit(lh, 'first-contentful-paint'),
      performanceScore: typeof score === 'number' ? Math.round(score * 100) : null,
      raw: { fetchTime: lh?.fetchTime ?? null, lighthouseVersion: lh?.lighthouseVersion ?? null },
    };
  }

  async fetchCrux(url: string, formFactor: WebVitalFormFactor): Promise<CruxFieldResult | null> {
    const payload: Record<string, unknown> = { url };
    if (formFactor !== 'ALL') payload.formFactor = formFactor === 'DESKTOP' ? 'DESKTOP' : 'PHONE';
    const res = await this.fetchImpl(`${CRUX_ENDPOINT}?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // 404 = the URL has too little real-user traffic to report. Not an error.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`CrUX returned HTTP ${res.status} for ${url}.`);
    const body: any = await res.json();
    const metrics = body?.record?.metrics;
    if (!metrics) return null;
    return {
      lcpMs: cruxP75(metrics.largest_contentful_paint),
      inpMs: cruxP75(metrics.interaction_to_next_paint),
      cls: cruxP75(metrics.cumulative_layout_shift),
      ttfbMs: cruxP75(metrics.experimental_time_to_first_byte),
      fcpMs: cruxP75(metrics.first_contentful_paint),
      distributions: metrics as Record<string, unknown>,
      sampleSize: null,
      raw: { collectionPeriod: body?.record?.collectionPeriod ?? null },
    };
  }
}
