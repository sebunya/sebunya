import type { WebVitalMeasurement } from './WebVitalsUseCases';

/**
 * Lighthouse Watch (2026-09-13).
 *
 * The storefront was tuned by hand to Lighthouse 100s; nothing then watched it.
 * This module turns a Lighthouse result — from the PageSpeed Insights API or
 * from the Lighthouse CLI run on the host — into one honest summary per URL
 * and form factor, stores it as a PAGESPEED_LAB web-vital row (the existing
 * Web Vitals module; `raw` carries the four category scores and the failing
 * audits), compares every category with its target, and raises or resolves
 * one SEO alert per shortfall. Pure functions first; the use case last.
 *
 * Targets default to 100 for every category. A shortfall is a fact, not a
 * failure of this module: the alert names the audits and, where the cause
 * is a Cloudflare zone setting only the owner can change, says so.
 */
export const LIGHTHOUSE_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
export type LighthouseCategory = (typeof LIGHTHOUSE_CATEGORIES)[number];
export type LighthouseFormFactor = 'MOBILE' | 'DESKTOP';
export type LighthouseRunner = 'pagespeed-api' | 'lighthouse-cli';

export interface LighthouseFailingAudit {
  id: string;
  title: string;
  score: number | null;
  displayValue: string | null;
  category: LighthouseCategory;
  weight: number;
  /** Set when the cause is outside the codebase (a Cloudflare zone setting). */
  ownerAction: string | null;
}

export interface LighthouseLabSummary {
  url: string;
  formFactor: LighthouseFormFactor;
  runner: LighthouseRunner;
  fetchTime: string | null;
  lighthouseVersion: string | null;
  categories: Record<LighthouseCategory, number | null>;
  metrics: { lcpMs: number | null; fcpMs: number | null; cls: number | null; tbtMs: number | null; speedIndexMs: number | null; ttfbMs: number | null };
  failingAudits: LighthouseFailingAudit[];
}

export type LighthouseTargets = Record<LighthouseCategory, number>;
export const DEFAULT_LIGHTHOUSE_TARGETS: LighthouseTargets = { performance: 100, accessibility: 100, 'best-practices': 100, seo: 100 };

/**
 * Audits whose cause is a Cloudflare zone setting, not this codebase. The alert
 * says who must act, so nobody spends an evening hunting in the repository.
 * See docs/hardening/cloudflare-lighthouse-owner-settings.md.
 */
export const OWNER_ACTION_AUDITS: Record<string, string> = {
  deprecations: 'Cloudflare → Security → Bots → JavaScript Detections: turn OFF (the deprecated APIs are in cdn-cgi/challenge-platform, not our code).',
  'robots-txt': 'Cloudflare → AI Audit / Bots → managed robots.txt (Content-Signal): turn OFF, or accept SEO 92.',
  'errors-in-console': 'If the error names static.cloudflareinsights.com: Cloudflare → Analytics → Web Analytics is injecting a beacon; the site CSP allows it since 2026-09-13, so a fresh error here is a new source.',
  'uses-long-cache-ttl': 'If only cdn-cgi / cloudflareinsights URLs remain: Cloudflare → Speed → Rocket Loader OFF and Web Analytics OFF; origin static files carry 30-day headers.',
  'third-party-summary': 'Cloudflare-injected scripts (Rocket Loader, JS Detections, Web Analytics) are zone settings: see the owner settings document.',
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const auditNumeric = (lhr: any, id: string): number | null => num(lhr?.audits?.[id]?.numericValue);

/** Turn a Lighthouse result object (PSI `lighthouseResult` or CLI JSON) into the summary the watch stores. */
export function summariseLighthouseResult(lhr: any, formFactor: LighthouseFormFactor, runner: LighthouseRunner): LighthouseLabSummary | null {
  if (!lhr || typeof lhr !== 'object' || !lhr.categories || !lhr.audits) return null;
  const url = String(lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl ?? '').trim();
  if (!url) return null;
  const categories = {} as Record<LighthouseCategory, number | null>;
  const failingAudits: LighthouseFailingAudit[] = [];
  for (const cat of LIGHTHOUSE_CATEGORIES) {
    const c = lhr.categories[cat];
    const score = num(c?.score);
    categories[cat] = score === null ? null : Math.round(score * 100);
    for (const ref of Array.isArray(c?.auditRefs) ? c.auditRefs : []) {
      const weight = num(ref?.weight) ?? 0;
      if (weight <= 0) continue;
      const au = lhr.audits[ref.id];
      const s = num(au?.score);
      if (s === null || s >= 1) continue;
      failingAudits.push({
        id: String(ref.id),
        title: String(au?.title ?? ref.id),
        score: s,
        displayValue: typeof au?.displayValue === 'string' ? au.displayValue : null,
        category: cat,
        weight,
        ownerAction: OWNER_ACTION_AUDITS[String(ref.id)] ?? null,
      });
    }
  }
  failingAudits.sort((a, b) => b.weight - a.weight || (a.score ?? 0) - (b.score ?? 0));
  return {
    url,
    formFactor,
    runner,
    fetchTime: typeof lhr.fetchTime === 'string' ? lhr.fetchTime : null,
    lighthouseVersion: typeof lhr.lighthouseVersion === 'string' ? lhr.lighthouseVersion : null,
    categories,
    metrics: {
      lcpMs: auditNumeric(lhr, 'largest-contentful-paint'),
      fcpMs: auditNumeric(lhr, 'first-contentful-paint'),
      cls: auditNumeric(lhr, 'cumulative-layout-shift'),
      tbtMs: auditNumeric(lhr, 'total-blocking-time'),
      speedIndexMs: auditNumeric(lhr, 'speed-index'),
      ttfbMs: auditNumeric(lhr, 'server-response-time'),
    },
    failingAudits,
  };
}

/** The Web Vitals row for a summary. One row per (url, PAGESPEED_LAB, form factor, day); a later run the same day replaces it. */
export function toWebVitalMeasurement(summary: LighthouseLabSummary, collectionDate: string): WebVitalMeasurement {
  return {
    url: summary.url,
    source: 'PAGESPEED_LAB',
    formFactor: summary.formFactor,
    collectionDate,
    lcpMs: summary.metrics.lcpMs,
    inpMs: null,
    cls: summary.metrics.cls,
    ttfbMs: summary.metrics.ttfbMs,
    fcpMs: summary.metrics.fcpMs,
    performanceScore: summary.categories.performance,
    raw: {
      runner: summary.runner,
      fetchTime: summary.fetchTime,
      lighthouseVersion: summary.lighthouseVersion,
      categories: summary.categories,
      tbtMs: summary.metrics.tbtMs,
      speedIndexMs: summary.metrics.speedIndexMs,
      failingAudits: summary.failingAudits,
    },
  };
}

export interface LighthouseShortfall {
  url: string;
  formFactor: LighthouseFormFactor;
  category: LighthouseCategory;
  score: number;
  target: number;
  audits: LighthouseFailingAudit[];
  dedupeKey: string;
  /** True when every failing audit behind this shortfall is an owner (Cloudflare) action. */
  ownerOnly: boolean;
}

export const lighthouseDedupeKey = (url: string, formFactor: LighthouseFormFactor, category: LighthouseCategory): string =>
  `lighthouse:${formFactor}:${category}:${url}`;

/** Compare every category with its target. A null score (category not run) is reported as a shortfall of unknown size, never as 100. */
export function evaluateLighthouse(summaries: LighthouseLabSummary[], targets: LighthouseTargets = DEFAULT_LIGHTHOUSE_TARGETS): { ok: boolean; shortfalls: LighthouseShortfall[]; met: string[] } {
  const shortfalls: LighthouseShortfall[] = [];
  const met: string[] = [];
  for (const s of summaries) {
    for (const cat of LIGHTHOUSE_CATEGORIES) {
      const target = targets[cat];
      const score = s.categories[cat];
      const key = lighthouseDedupeKey(s.url, s.formFactor, cat);
      if (score !== null && score >= target) {
        met.push(key);
        continue;
      }
      const audits = s.failingAudits.filter((a) => a.category === cat);
      shortfalls.push({
        url: s.url,
        formFactor: s.formFactor,
        category: cat,
        score: score ?? 0,
        target,
        audits,
        dedupeKey: key,
        ownerOnly: audits.length > 0 && audits.every((a) => a.ownerAction !== null),
      });
    }
  }
  return { ok: shortfalls.length === 0, shortfalls, met };
}

export function describeShortfall(s: LighthouseShortfall): string {
  const audits = s.audits.slice(0, 5).map((a) => `${a.id}${a.displayValue ? ` (${a.displayValue})` : ''}${a.ownerAction ? ' — OWNER: ' + a.ownerAction : ''}`);
  return `${s.formFactor} ${s.category} ${s.score}/${s.target} at ${s.url}${audits.length ? ': ' + audits.join('; ') : ''}`;
}

export function targetsFromEnv(envLookup: (name: string) => string | undefined): LighthouseTargets {
  const read = (name: string, fallback: number): number => {
    const v = Number(envLookup(name));
    return Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : fallback;
  };
  return {
    performance: read('LIGHTHOUSE_WATCH_TARGET_PERFORMANCE', 100),
    accessibility: read('LIGHTHOUSE_WATCH_TARGET_ACCESSIBILITY', 100),
    'best-practices': read('LIGHTHOUSE_WATCH_TARGET_BEST_PRACTICES', 100),
    seo: read('LIGHTHOUSE_WATCH_TARGET_SEO', 100),
  };
}

// ── Use case ──────────────────────────────────────────────────────────────────

export interface LighthouseVitalsStore {
  upsertWebVital(m: WebVitalMeasurement): Promise<unknown>;
}
export interface LighthouseAlertStore {
  raiseAlert(input: { severity: string; kind: string; message: string; dedupeKey: string }): Promise<unknown>;
  listAlerts(filter?: { status?: string; limit?: number }): Promise<Array<{ id: string; dedupe_key?: string; dedupeKey?: string; kind?: string }>>;
  resolveAlert(id: string): Promise<boolean>;
}

export const LIGHTHOUSE_ALERT_KIND = 'LIGHTHOUSE_BELOW_TARGET';

export interface RecordLighthouseReportInput {
  reports: Array<{ formFactor: LighthouseFormFactor; lhr: unknown; runner: LighthouseRunner }>;
  collectionDate: string; // YYYY-MM-DD
  targets?: LighthouseTargets;
}

export interface RecordLighthouseReportResult {
  stored: number;
  rejected: number;
  ok: boolean;
  shortfalls: LighthouseShortfall[];
  summaries: LighthouseLabSummary[];
  alertsRaised: number;
  alertsResolved: number;
}

export class RecordLighthouseReportUseCase {
  constructor(
    private readonly vitals: LighthouseVitalsStore,
    private readonly alerts: LighthouseAlertStore,
  ) {}

  async execute(input: RecordLighthouseReportInput): Promise<RecordLighthouseReportResult> {
    const summaries: LighthouseLabSummary[] = [];
    let rejected = 0;
    for (const r of input.reports) {
      const s = summariseLighthouseResult(r.lhr, r.formFactor, r.runner);
      if (!s) { rejected++; continue; }
      summaries.push(s);
    }
    for (const s of summaries) await this.vitals.upsertWebVital(toWebVitalMeasurement(s, input.collectionDate));

    const evaluation = evaluateLighthouse(summaries, input.targets ?? DEFAULT_LIGHTHOUSE_TARGETS);
    let alertsRaised = 0;
    for (const sf of evaluation.shortfalls) {
      await this.alerts.raiseAlert({
        severity: sf.ownerOnly ? 'WARN' : 'CRITICAL',
        kind: LIGHTHOUSE_ALERT_KIND,
        message: describeShortfall(sf),
        dedupeKey: sf.dedupeKey,
      });
      alertsRaised++;
    }
    // A category back at target closes its open alert — only for the cells this run measured.
    let alertsResolved = 0;
    const open = await this.alerts.listAlerts({ status: 'OPEN', limit: 500 });
    const metKeys = new Set(evaluation.met);
    for (const a of open) {
      if (a.kind !== LIGHTHOUSE_ALERT_KIND) continue;
      const key = String(a.dedupe_key ?? a.dedupeKey ?? '');
      if (metKeys.has(key) && (await this.alerts.resolveAlert(a.id))) alertsResolved++;
    }
    return { stored: summaries.length, rejected, ok: evaluation.ok, shortfalls: evaluation.shortfalls, summaries, alertsRaised, alertsResolved };
  }
}
