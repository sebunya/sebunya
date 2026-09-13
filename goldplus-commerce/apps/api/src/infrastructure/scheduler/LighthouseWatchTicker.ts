import * as client from 'prom-client';
import { Registry } from '../Registry';
import { logger } from '../logging/logger';
import { LIGHTHOUSE_ALERT_KIND, LIGHTHOUSE_CATEGORIES, describeShortfall, evaluateLighthouse, targetsFromEnv, type LighthouseLabSummary } from '../../application/use-cases/seo-growth/LighthouseWatchUseCases';

/**
 * Lighthouse Watch ticker (2026-09-13).
 *
 * Two things, on a schedule:
 *  1. With GOOGLE_PAGESPEED_API_KEY set, pulls fresh PageSpeed Insights results
 *     (all four categories, mobile and desktop) for the watch URLs every 96 h
 *     and records them through the same use case the host runner posts to.
 *  2. Always: every 6 h re-reads the latest stored lab rows, publishes them as
 *     Prometheus gauges, and repeats the ALERT line while anything is below
 *     target, so a shortfall cannot go quiet between runs.
 *
 * Without a Google key the measurements come from the host runner
 * (scripts/lighthouse-watch.sh, at most once every 96 h, cron or deploy); the
 * ticker says so once at boot instead of pretending to measure.
 */
function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
// Owner decision 2026-09-13: measure at most every 96 hours so the host is never
// busy with audits. The review only reads stored rows and runs every 6 hours.
const PULL_INTERVAL_MS = envInt('LIGHTHOUSE_WATCH_INTERVAL_MINUTES', 96 * 60) * 60_000;
const REVIEW_INTERVAL_MS = 6 * 60 * 60_000;
const WATCH_URLS = (process.env.LIGHTHOUSE_WATCH_URLS ?? 'https://shopgoldplus.com/ https://shopgoldplus.com/shop').split(/[\s,]+/).filter(Boolean);

const scoreGauge = new client.Gauge({
  name: 'goldplus_lighthouse_score',
  help: 'Latest Lighthouse category score (0-100) per URL and form factor, from the last stored lab run.',
  labelNames: ['url', 'form_factor', 'category'],
});
try { client.register.registerMetric(scoreGauge); } catch { /* already registered */ }

let pullTimer: NodeJS.Timeout | null = null;
let reviewTimer: NodeJS.Timeout | null = null;
let running = false;

/** Latest stored lab rows → summaries (only what the row's raw carries; nothing invented). */
async function latestSummaries(): Promise<LighthouseLabSummary[]> {
  const rows = await Registry.getInstance().seoTechnicalRepo.latestWebVitals({});
  const out: LighthouseLabSummary[] = [];
  for (const r of rows as any[]) {
    if (String(r.source) !== 'PAGESPEED_LAB') continue;
    const raw = (r.raw ?? {}) as any;
    if (!raw.categories) continue;
    out.push({
      url: String(r.url),
      formFactor: String(r.form_factor ?? r.formFactor) === 'DESKTOP' ? 'DESKTOP' : 'MOBILE',
      runner: raw.runner === 'pagespeed-api' ? 'pagespeed-api' : 'lighthouse-cli',
      fetchTime: raw.fetchTime ?? null,
      lighthouseVersion: raw.lighthouseVersion ?? null,
      categories: raw.categories,
      metrics: { lcpMs: null, fcpMs: null, cls: null, tbtMs: raw.tbtMs ?? null, speedIndexMs: raw.speedIndexMs ?? null, ttfbMs: null },
      failingAudits: Array.isArray(raw.failingAudits) ? raw.failingAudits : [],
    });
  }
  return out;
}

async function review(): Promise<void> {
  try {
    const summaries = await latestSummaries();
    for (const s of summaries) {
      for (const cat of LIGHTHOUSE_CATEGORIES) {
        const v = s.categories[cat];
        if (v !== null) scoreGauge.set({ url: s.url, form_factor: s.formFactor, category: cat }, v);
      }
    }
    if (summaries.length === 0) {
      logger.warn('[lighthouse-watch] no lab results stored yet — the host runner has not posted, or GOOGLE_PAGESPEED_API_KEY is unset');
      return;
    }
    const evaluation = evaluateLighthouse(summaries, targetsFromEnv((k) => process.env[k]));
    if (!evaluation.ok) {
      logger.error(
        { shortfalls: evaluation.shortfalls.map(describeShortfall), kind: LIGHTHOUSE_ALERT_KIND },
        `ALERT LIGHTHOUSE_BELOW_TARGET — ${evaluation.shortfalls.length} cell(s) below target in the latest stored run`,
      );
    }
  } catch (error) {
    logger.error({ err: error }, '[lighthouse-watch] review failed');
  }
}

async function pullFromPageSpeed(): Promise<void> {
  const key = (process.env.GOOGLE_PAGESPEED_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim();
  if (!key || running) return;
  running = true;
  try {
    const reports: Array<{ formFactor: 'MOBILE' | 'DESKTOP'; lhr: unknown; runner: 'pagespeed-api' }> = [];
    for (const url of WATCH_URLS) {
      for (const ff of ['MOBILE', 'DESKTOP'] as const) {
        const q = new URLSearchParams({ url, strategy: ff === 'DESKTOP' ? 'desktop' : 'mobile', key });
        for (const cat of LIGHTHOUSE_CATEGORIES) q.append('category', cat);
        const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q.toString()}`, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) { logger.warn({ url, ff, status: res.status }, '[lighthouse-watch] PageSpeed request failed'); continue; }
        const body: any = await res.json().catch(() => null);
        if (body?.lighthouseResult) reports.push({ formFactor: ff, lhr: body.lighthouseResult, runner: 'pagespeed-api' });
      }
    }
    if (reports.length === 0) return;
    const result = await Registry.getInstance().recordLighthouseReportUseCase.execute({
      reports, collectionDate: new Date().toISOString().slice(0, 10), targets: targetsFromEnv((k) => process.env[k]),
    });
    logger.info({ stored: result.stored, ok: result.ok, alertsRaised: result.alertsRaised, alertsResolved: result.alertsResolved }, '[lighthouse-watch] PageSpeed pull recorded');
  } catch (error) {
    logger.error({ err: error }, '[lighthouse-watch] PageSpeed pull failed');
  } finally {
    running = false;
  }
}

export function startLighthouseWatchTicker(): void {
  const hasKey = Boolean((process.env.GOOGLE_PAGESPEED_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim());
  logger.info(
    { urls: WATCH_URLS, pullEveryMinutes: hasKey ? PULL_INTERVAL_MS / 60_000 : null, source: hasKey ? 'pagespeed-api' : 'host runner (scripts/lighthouse-watch.sh)' },
    hasKey ? '[lighthouse-watch] started with PageSpeed pulls' : '[lighthouse-watch] started; no GOOGLE_PAGESPEED_API_KEY — measurements come from the host runner',
  );
  reviewTimer = setInterval(() => void review(), REVIEW_INTERVAL_MS);
  setTimeout(() => void review(), 90_000);
  if (hasKey) {
    pullTimer = setInterval(() => void pullFromPageSpeed(), PULL_INTERVAL_MS);
    setTimeout(() => void pullFromPageSpeed(), 15 * 60_000);
  }
}

export function stopLighthouseWatchTicker(): void {
  if (pullTimer) clearInterval(pullTimer);
  if (reviewTimer) clearInterval(reviewTimer);
  pullTimer = null; reviewTimer = null;
}
