import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';

/**
 * Microsoft Clarity, server to server (0207, 2026-10-25). The browser tag (PUBLIC_CLARITY_ID, BaseLayout) is what
 * records sessions; no server call can do that. This pull brings Clarity's DASHBOARD NUMBERS into the shop every
 * night through its Data Export API, so the frustration signals (rage clicks, dead clicks, error clicks,
 * quickbacks, script errors), scroll depth, engagement time and the popular pages sit in our tables beside GA4's
 * series and survive Clarity's three-day export window.
 *
 * Contract (learn.microsoft.com/clarity/setup-and-installation/clarity-data-export-api, read 2026-10-25): GET
 * www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1|2|3[&dimension1..3], header
 * `Authorization: Bearer <token>` (token: Clarity > Settings > Data Export, project admin only). numOfDays=1 is
 * the last 24 hours SINCE THE CALL, in UTC; 10 requests a project a day; 1,000 rows; no paging; 429 past the
 * limit. The answer is `[{ metricName, information: [{ ...numbers as strings, <Dimension>: value }] }]`.
 *
 * Budget: three calls a night (totals, by URL, by Channel), leaving seven for people; a second run on the same
 * day (an admin "Rebuild now") is skipped so a hand-pressed button never burns the budget. The nightly runs at
 * 03:30-05:59 Kampala (00:30-02:59 UTC), so "the last 24 hours" is, near enough, the previous UTC day; rows are
 * filed under that day and the exact fetch time is kept. A missing token writes nothing and says "not configured".
 */
const ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';
export const CLARITY_BREAKDOWNS = ['total', 'URL', 'Channel'] as const;
export type ClarityBreakdown = (typeof CLARITY_BREAKDOWNS)[number];
const TIMEOUT_MS = 20_000;
const REPULL_AFTER_HOURS = 20;
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

export interface ClarityPullResult { configured: boolean; day: string | null; rows: number; skipped?: string; calls: Partial<Record<ClarityBreakdown, number | { error: string }>> }
export interface ClarityInsightItem { metricName?: string; information?: Array<Record<string, unknown>> }
export interface ClarityFlatRow { breakdownValue: string; metric: string; field: string; value: number }

/**
 * The numbers out of one API answer, as flat rows. In the totals call a metric such as PopularPages, Browser or
 * Country/Region carries one name column per row; that name becomes the row key so the rows do not collapse.
 * Exported for the unit test.
 */
export function flatten(items: ClarityInsightItem[], breakdown: ClarityBreakdown): ClarityFlatRow[] {
  const out: ClarityFlatRow[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const metric = String(item?.metricName ?? '').slice(0, 40);
    if (!metric) continue;
    for (const info of Array.isArray(item.information) ? item.information : []) {
      const entries = Object.entries(info ?? {});
      const numeric: Array<[string, number]> = [];
      const names: string[] = [];
      for (const [field, raw] of entries) {
        if (field === breakdown) continue;
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : NaN;
        if (Number.isFinite(n)) numeric.push([field, n]); else if (typeof raw === 'string' && raw.trim()) names.push(raw.trim());
      }
      const keyed = breakdown === 'total' ? String(info?.[breakdown] ?? names[0] ?? '') : String(info?.[breakdown] ?? '(not set)');
      const breakdownValue = keyed.slice(0, 300);
      for (const [field, value] of numeric) out.push({ breakdownValue, metric, field: field.slice(0, 48), value });
    }
  }
  return out;
}

export class ClarityInsightsPull {
  constructor(private readonly token: string | undefined, private readonly fetchImpl: typeof fetch = fetch) {}

  async run(now = new Date()): Promise<ClarityPullResult> {
    const token = (this.token ?? '').trim();
    if (!token) return { configured: false, day: null, rows: 0, calls: {} };
    // numOfDays=1 covers the 24 hours before the call (UTC): filed under the UTC day that window mostly lies in.
    const day = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const out: ClarityPullResult = { configured: true, day, rows: 0, calls: {} };
    const recent = rows(await db.execute(sql`select 1 from measurement.clarity_insights where day = ${day}::date and fetched_at > ${new Date(now.getTime() - REPULL_AFTER_HOURS * 3600_000)} limit 1`));
    if (recent.length) return { ...out, skipped: `already pulled for ${day}; Clarity allows ten export calls a day` };
    for (const breakdown of CLARITY_BREAKDOWNS) {
      try {
        const url = `${ENDPOINT}?numOfDays=1${breakdown === 'total' ? '' : `&dimension1=${breakdown}`}`;
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
        if (res.status === 429) { out.calls[breakdown] = { error: 'Clarity daily export limit reached (10 calls a day)' }; break; } // the rest would fail too
        if (!res.ok) throw new Error(`Clarity answered HTTP ${res.status}`);
        const json = await res.json() as ClarityInsightItem[];
        if (!Array.isArray(json)) throw new Error('Clarity answered something other than the insights list');
        const flat = flatten(json, breakdown);
        let n = 0;
        await db.transaction(async (tx) => {
          for (const r of flat) {
            await tx.execute(sql`insert into measurement.clarity_insights (day, breakdown, breakdown_value, metric, field, value, fetched_at)
              values (${day}::date, ${breakdown}, ${r.breakdownValue}, ${r.metric}, ${r.field}, ${r.value}, ${now})
              on conflict (day, breakdown, breakdown_value, metric, field) do update set value = excluded.value, fetched_at = excluded.fetched_at`);
            n++;
          }
        });
        out.calls[breakdown] = n; out.rows += n;
      } catch (err) {
        out.calls[breakdown] = { error: String((err as Error).message ?? err).slice(0, 200) };
        logger.warn({ err: (err as Error).message, breakdown }, '[clarity] export call failed');
      }
    }
    return out;
  }

  /** The latest day's totals, the pages with most frustration, and sessions by channel, for the admin page. */
  async summary(): Promise<ClaritySummary | null> {
    const last = rows(await db.execute(sql`select max(day)::text as day from measurement.clarity_insights`))[0];
    if (!last?.day) return null;
    const day = String(last.day);
    const totals: Record<string, number> = {};
    let fetchedAt: string | null = null;
    for (const r of rows(await db.execute(sql`select metric, field, value, fetched_at from measurement.clarity_insights where day = ${day}::date and breakdown = 'total' and breakdown_value = ''`))) {
      totals[`${r.metric}.${r.field}`] = Number(r.value);
      if (r.fetched_at) fetchedAt = new Date(r.fetched_at).toISOString();
    }
    const byUrl = new Map<string, ClaritySummary['pages'][number]>();
    for (const r of rows(await db.execute(sql`select breakdown_value, metric, field, value from measurement.clarity_insights where day = ${day}::date and breakdown = 'URL'
        and ((metric = 'Traffic' and field = 'totalSessionCount') or (metric in ('RageClickCount','DeadClickCount','QuickbackClick','ErrorClickCount') and field = 'sessionsCount'))`))) {
      const url = String(r.breakdown_value);
      const e = byUrl.get(url) ?? { url, sessions: 0, rageClicks: 0, deadClicks: 0, quickbacks: 0, errorClicks: 0 };
      const v = Number(r.value);
      if (r.metric === 'Traffic') e.sessions = v; else if (r.metric === 'RageClickCount') e.rageClicks = v; else if (r.metric === 'DeadClickCount') e.deadClicks = v; else if (r.metric === 'QuickbackClick') e.quickbacks = v; else e.errorClicks = v;
      byUrl.set(url, e);
    }
    const frustration = (p: ClaritySummary['pages'][number]) => p.rageClicks + p.deadClicks + p.quickbacks + p.errorClicks;
    const pages = [...byUrl.values()].sort((a, b) => frustration(b) - frustration(a) || b.sessions - a.sessions).slice(0, 12);
    const channels = rows(await db.execute(sql`select breakdown_value, value from measurement.clarity_insights where day = ${day}::date and breakdown = 'Channel' and metric = 'Traffic' and field = 'totalSessionCount' order by value desc limit 12`))
      .map((r) => ({ channel: String(r.breakdown_value), sessions: Number(r.value) }));
    const days = Number(rows(await db.execute(sql`select count(distinct day)::int as n from measurement.clarity_insights`))[0]?.n ?? 0);
    return { day, days, fetchedAt, totals, pages, channels };
  }
}

export interface ClaritySummary {
  day: string; days: number; fetchedAt: string | null; totals: Record<string, number>;
  pages: Array<{ url: string; sessions: number; rageClicks: number; deadClicks: number; quickbacks: number; errorClicks: number }>;
  channels: Array<{ channel: string; sessions: number }>;
}
