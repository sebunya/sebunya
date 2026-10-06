import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_LIGHTHOUSE_TARGETS,
  RecordLighthouseReportUseCase,
  describeShortfall,
  evaluateLighthouse,
  lighthouseDedupeKey,
  summariseLighthouseResult,
  targetsFromEnv,
  toWebVitalMeasurement,
  type LighthouseLabSummary,
} from '../../apps/api/src/application/use-cases/seo-growth/LighthouseWatchUseCases';

/** A minimal Lighthouse result in the shape both PSI and the CLI produce. */
function lhr(overrides: Partial<Record<'performance' | 'accessibility' | 'best-practices' | 'seo', number>> = {}, failing: Array<{ id: string; cat: string; score: number; weight?: number; displayValue?: string }> = []) {
  const scores = { performance: 1, accessibility: 1, 'best-practices': 1, seo: 1, ...overrides };
  const audits: Record<string, any> = {
    'largest-contentful-paint': { numericValue: 1800 }, 'first-contentful-paint': { numericValue: 900 },
    'cumulative-layout-shift': { numericValue: 0.01 }, 'total-blocking-time': { numericValue: 40 },
    'speed-index': { numericValue: 1500 }, 'server-response-time': { numericValue: 300 },
  };
  const refs: Record<string, any[]> = { performance: [], accessibility: [], 'best-practices': [], seo: [] };
  for (const f of failing) {
    audits[f.id] = { ...(audits[f.id] ?? {}), title: f.id.toUpperCase(), score: f.score, displayValue: f.displayValue ?? null };
    refs[f.cat].push({ id: f.id, weight: f.weight ?? 1 });
  }
  const categories: Record<string, any> = {};
  for (const [k, v] of Object.entries(scores)) categories[k] = { score: v, auditRefs: refs[k] };
  return { finalDisplayedUrl: 'https://shopgoldplus.com/', fetchTime: '2026-09-13T04:00:00.000Z', lighthouseVersion: '12.0.0', categories, audits };
}

describe('summariseLighthouseResult', () => {
  it('reads the four category scores, the metrics and only the weighted failing audits', () => {
    const s = summariseLighthouseResult(lhr({ performance: 0.82, seo: 0.92 }, [
      { id: 'robots-txt', cat: 'seo', score: 0, weight: 1 },
      { id: 'largest-contentful-paint', cat: 'performance', score: 0.5, weight: 25, displayValue: '3.7 s' },
      { id: 'unused-javascript', cat: 'performance', score: 0, weight: 0 }, // informational: weight 0 never counts
    ]), 'MOBILE', 'lighthouse-cli')!;
    expect(s.categories).toEqual({ performance: 82, accessibility: 100, 'best-practices': 100, seo: 92 });
    expect(s.metrics.lcpMs).toBe(1800);
    expect(s.failingAudits.map((a) => a.id)).toEqual(['largest-contentful-paint', 'robots-txt']); // heaviest first
    expect(s.failingAudits[1].ownerAction).toMatch(/Cloudflare/);
    expect(s.failingAudits[0].ownerAction).toBeNull();
  });

  it('returns null for anything that is not a Lighthouse result', () => {
    expect(summariseLighthouseResult(null, 'MOBILE', 'lighthouse-cli')).toBeNull();
    expect(summariseLighthouseResult({ categories: {} }, 'MOBILE', 'lighthouse-cli')).toBeNull();
    expect(summariseLighthouseResult({ categories: { performance: { score: 1 } }, audits: {} }, 'MOBILE', 'lighthouse-cli')).toBeNull(); // no URL
  });

  it('maps to a PAGESPEED_LAB web-vital row carrying the categories in raw, never inventing INP', () => {
    const s = summariseLighthouseResult(lhr(), 'DESKTOP', 'pagespeed-api')!;
    const m = toWebVitalMeasurement(s, '2026-09-13');
    expect(m).toMatchObject({ source: 'PAGESPEED_LAB', formFactor: 'DESKTOP', collectionDate: '2026-09-13', performanceScore: 100, inpMs: null, lcpMs: 1800 });
    expect((m.raw as any).categories.seo).toBe(100);
    expect((m.raw as any).runner).toBe('pagespeed-api');
  });
});

describe('evaluateLighthouse', () => {
  const summary = (scores: Partial<Record<string, number>>, failing: any[] = []): LighthouseLabSummary =>
    summariseLighthouseResult(lhr(scores as any, failing), 'MOBILE', 'lighthouse-cli')!;

  it('is ok only when every category meets its target, and a missing category is a shortfall, not a pass', () => {
    expect(evaluateLighthouse([summary({})]).ok).toBe(true);
    const r = evaluateLighthouse([summary({ accessibility: 0.98 })]);
    expect(r.ok).toBe(false);
    expect(r.shortfalls.map((s) => s.category)).toEqual(['accessibility']);
    const missing = summary({}); (missing.categories as any).seo = null;
    expect(evaluateLighthouse([missing]).shortfalls.map((s) => s.category)).toEqual(['seo']);
  });

  it('flags a shortfall as owner-only when every failing audit is a Cloudflare setting', () => {
    const r = evaluateLighthouse([summary({ seo: 0.92, 'best-practices': 0.82 }, [
      { id: 'robots-txt', cat: 'seo', score: 0 },
      { id: 'deprecations', cat: 'best-practices', score: 0 },
    ])]);
    expect(r.shortfalls.every((s) => s.ownerOnly)).toBe(true);
    const mixed = evaluateLighthouse([summary({ 'best-practices': 0.8 }, [
      { id: 'deprecations', cat: 'best-practices', score: 0 },
      { id: 'errors-in-console', cat: 'best-practices', score: 0 },
      { id: 'image-aspect-ratio', cat: 'best-practices', score: 0 },
    ])]);
    expect(mixed.shortfalls[0].ownerOnly).toBe(false);
  });

  it('honours env targets and clamps nonsense', () => {
    const t = targetsFromEnv((k) => ({ LIGHTHOUSE_WATCH_TARGET_PERFORMANCE: '95', LIGHTHOUSE_WATCH_TARGET_SEO: '250' } as any)[k]);
    expect(t).toEqual({ ...DEFAULT_LIGHTHOUSE_TARGETS, performance: 95 });
    expect(evaluateLighthouse([summary({ performance: 0.96 })], t).ok).toBe(true);
    // compose passes "" for an unset variable: it must fall back to 100, never become a target of 0
    const empty = targetsFromEnv(() => '');
    expect(empty).toEqual(DEFAULT_LIGHTHOUSE_TARGETS);
    expect(evaluateLighthouse([summary({ performance: 0.95 })], empty).ok).toBe(false);
  });

  it('describes a shortfall with its audits and the owner action', () => {
    const r = evaluateLighthouse([summary({ seo: 0.92 }, [{ id: 'robots-txt', cat: 'seo', score: 0, displayValue: '1 error found' }])]);
    expect(describeShortfall(r.shortfalls[0])).toMatch(/^MOBILE seo 92\/100 at https:\/\/shopgoldplus.com\/: robots-txt \(1 error found\) — OWNER: Cloudflare/);
    expect(r.shortfalls[0].dedupeKey).toBe(lighthouseDedupeKey('https://shopgoldplus.com/', 'MOBILE', 'seo'));
  });
});

describe('RecordLighthouseReportUseCase', () => {
  function stores() {
    const rows: any[] = [];
    const alerts: any[] = [];
    let seq = 0;
    return {
      rows, alerts,
      vitals: { upsertWebVital: async (m: any) => { rows.push(m); return m; } },
      alertStore: {
        raiseAlert: async (a: any) => {
          const open = alerts.find((x) => x.dedupe_key === a.dedupeKey && x.status === 'OPEN');
          if (open) { open.message = a.message; return open; }
          const row = { id: `a-${++seq}`, dedupe_key: a.dedupeKey, kind: a.kind, status: 'OPEN', severity: a.severity, message: a.message };
          alerts.push(row); return row;
        },
        listAlerts: async (f: any) => alerts.filter((x) => !f?.status || x.status === f.status),
        resolveAlert: async (id: string) => { const a = alerts.find((x) => x.id === id && x.status !== 'RESOLVED'); if (!a) return false; a.status = 'RESOLVED'; return true; },
      },
    };
  }

  it('stores one row per report, raises one alert per shortfall, dedupes on repeat, and resolves when the cell recovers', async () => {
    const s = stores();
    const uc = new RecordLighthouseReportUseCase(s.vitals, s.alertStore);
    const first = await uc.execute({ collectionDate: '2026-09-13', reports: [
      { formFactor: 'MOBILE', runner: 'lighthouse-cli', lhr: lhr({ seo: 0.92 }, [{ id: 'robots-txt', cat: 'seo', score: 0 }]) },
      { formFactor: 'DESKTOP', runner: 'lighthouse-cli', lhr: lhr() },
      { formFactor: 'MOBILE', runner: 'lighthouse-cli', lhr: { junk: true } },
    ] });
    expect(first).toMatchObject({ stored: 2, rejected: 1, ok: false, alertsRaised: 1, alertsResolved: 0 });
    expect(s.rows).toHaveLength(2);
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0].severity).toBe('WARN'); // owner-only cause

    const again = await uc.execute({ collectionDate: '2026-09-13', reports: [{ formFactor: 'MOBILE', runner: 'lighthouse-cli', lhr: lhr({ seo: 0.92 }, [{ id: 'robots-txt', cat: 'seo', score: 0 }]) }] });
    expect(again.alertsRaised).toBe(1);
    expect(s.alerts).toHaveLength(1); // deduped while OPEN

    const fixed = await uc.execute({ collectionDate: '2026-09-14', reports: [{ formFactor: 'MOBILE', runner: 'lighthouse-cli', lhr: lhr() }] });
    expect(fixed).toMatchObject({ ok: true, alertsRaised: 0, alertsResolved: 1 });
    expect(s.alerts[0].status).toBe('RESOLVED');
  });

  it('a code-caused shortfall is CRITICAL', async () => {
    const s = stores();
    const uc = new RecordLighthouseReportUseCase(s.vitals, s.alertStore);
    await uc.execute({ collectionDate: '2026-09-13', reports: [{ formFactor: 'MOBILE', runner: 'lighthouse-cli', lhr: lhr({ accessibility: 0.96 }, [{ id: 'color-contrast', cat: 'accessibility', score: 0, weight: 7 }]) }] });
    expect(s.alerts[0].severity).toBe('CRITICAL');
  });
});

describe('the watch is wired, not just written', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
  it('the ingest route is mounted, the ticker starts and stops with the server, and the watch runs weekly on a fixed slot, never from a deploy', () => {
    expect(read('apps/api/src/interfaces/http/app.ts')).toMatch(/app\.route\('\/internal\/lighthouse', internalLighthouseRoutes\)/);
    const server = read('apps/api/src/interfaces/http/server.ts');
    expect(server).toMatch(/startLighthouseWatchTicker\(\)/);
    expect(server).toMatch(/stopLighthouseWatchTicker\(\)/);
    // Owner decisions 2026-10-06: weekly, Sunday 03:00 Kampala. A deploy that
    // started the watch reset its clock and moved the weekly run to its hour.
    expect(read('scripts/deploy-prod.sh')).not.toMatch(/lighthouse-watch\.sh (deploy|cron)/);
    // systemd, in Kampala time: no UTC arithmetic to get wrong.
    expect(read('ops/lighthouse-watch/goldplus-lighthouse-watch.timer')).toMatch(/^OnCalendar=Sun \*-\*-\* 03:00:00 Africa\/Kampala$/m);
    const unit = read('ops/lighthouse-watch/goldplus-lighthouse-watch.service');
    expect(unit).toMatch(/^ExecStart=\/opt\/goldplus\/app\/goldplus-commerce\/scripts\/lighthouse-watch\.sh cron$/m);
    expect(unit).toContain('OnFailure=goldplus-alert@%n.service');
    // the old daily cron file must be removed by the install steps, or it keeps firing at 06:17 Kampala
    expect(read('ops/lighthouse-watch/README.md')).toContain('rm -f /etc/cron.d/goldplus-lighthouse-watch');
    expect(read('scripts/lighthouse-watch.sh')).toMatch(/LIGHTHOUSE_WATCH_MIN_INTERVAL_HOURS:-24\}/);
    expect(read('apps/api/src/infrastructure/scheduler/LighthouseWatchTicker.ts')).toMatch(/'LIGHTHOUSE_WATCH_INTERVAL_MINUTES', 7 \* 24 \* 60\)/);
  });
  it('the ingest refuses without a 32+ character token and compares it in constant time', () => {
    const route = read('apps/api/src/interfaces/http/routes/internal/lighthouse.ts');
    expect(route).toMatch(/timingSafeEqual/);
    expect(route).toMatch(/length < 32/);
    expect(route).toMatch(/NOT_CONFIGURED/);
  });
});

describe('the weekly slot is never skipped by an earlier run', () => {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const script = path.resolve(__dirname, '../../scripts/lighthouse-watch.sh');

  function runWithStampHoursAgo(hours: number) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-lw-'));
    fs.writeFileSync(path.join(dir, 'lighthouse-watch.last-run'), String(Math.floor(Date.now() / 1000) - hours * 3600));
    // No token in this environment: a run that passes the guard stops right after "start".
    spawnSync('bash', [script, 'cron'], { env: { ...process.env, LIGHTHOUSE_WATCH_LOG_DIR: dir }, encoding: 'utf8' });
    return fs.readFileSync(path.join(dir, 'lighthouse-watch.log'), 'utf8');
  }

  it('the Sunday after a Tuesday run still measures (116 h later)', () => {
    expect(runWithStampHoursAgo(116)).toContain('lighthouse-watch start reason=cron');
  });

  it('a duplicate in the same night is refused', () => {
    expect(runWithStampHoursAgo(2)).toContain('lighthouse-watch skipped reason=cron');
  });
});

describe('one weekly measurement is the median of three, and a silent stop is noticed', () => {
  it('keeps the run whose performance score is the median, ignoring unusable runs', async () => {
    const { pickMedianRun, runKey } = await import('../../scripts/lighthouse-watch/median.mjs');
    const r = (p: number) => ({ categories: { performance: { score: p } }, tag: p });
    expect(pickMedianRun([r(0.71), r(0.93), r(0.82)]).tag).toBe(0.82);
    expect(pickMedianRun([r(0.9), null, { categories: {} }]).tag).toBe(0.9);
    expect(pickMedianRun([r(0.6), r(0.8)]).tag).toBe(0.6); // even count: the lower middle, never an optimistic pick
    expect(pickMedianRun([null])).toBeNull();
    expect(runKey('shopgoldplus_com_shop.mobile.2.json')).toEqual({ key: 'shopgoldplus_com_shop.mobile', formFactor: 'MOBILE' });
    expect(runKey('shopgoldplus_com_.desktop.json')).toEqual({ key: 'shopgoldplus_com_.desktop', formFactor: 'DESKTOP' });
    expect(runKey('notes.txt')).toBeNull();
  });

  it('the runner measures RUNS times (default 3) per URL and form factor', () => {
    const sh = readFileSync(resolve(__dirname, '../../scripts/lighthouse-watch.sh'), 'utf8');
    expect(sh).toMatch(/RUNS="\$\{LIGHTHOUSE_WATCH_RUNS:-3\}"/);
    expect(sh).toMatch(/for N in \$\(seq 1 "\$RUNS"\)/);
    expect(sh).toMatch(/--output-path="\/work\/\$SLUG\.\$FF\.\$N\.json"/);
    expect(sh).toContain('median.mjs');
  });

  it('flags measurements older than 8 days, and unknown ages, as stale', async () => {
    const { lighthouseStaleness } = await import('../../apps/api/src/infrastructure/scheduler/LighthouseWatchTicker');
    const now = Date.parse('2026-10-20T00:00:00Z');
    expect(lighthouseStaleness([{ fetchTime: '2026-10-18T00:05:00Z' }], now).stale).toBe(false);
    // the NEWEST measurement decides: one missed Sunday (7 days) is fine, two are not
    expect(lighthouseStaleness([{ fetchTime: '2026-10-04T00:05:00Z' }, { fetchTime: '2026-10-13T00:03:00Z' }], now).stale).toBe(false);
    expect(lighthouseStaleness([{ fetchTime: '2026-10-11T00:03:00Z' }], now).stale).toBe(true);
    const older = lighthouseStaleness([{ fetchTime: '2026-10-10T00:00:00Z' }], now);
    expect(older.stale).toBe(true);
    expect(older.ageDays).toBe(10);
    expect(lighthouseStaleness([{ fetchTime: null }], now).stale).toBe(true);
    expect(lighthouseStaleness([], now).stale).toBe(true);
  });
});
