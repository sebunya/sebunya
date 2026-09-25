import type { PlatformCredentials, SpendFactRepository, SpendGateway, SpendImportRecord, SpendReportRow } from '../../ports/Advertising';
import { currencyConflict, parseSpendCsv, spendFactErrors, type SpendFact } from '../../../domain/advertising/SpendFacts';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { CapabilityView } from './AdCapabilities';

/**
 * Ad spend per day, channel and campaign (docs/advertising/README.md,
 * "Spend"). Two ways in, one table (media_cost_facts):
 *  - the Google Ads API and the Meta Marketing API, when a spend capability is
 *    LIVE (daily, the last 7 days each time: platforms revise recent days);
 *  - a CSV upload in admin, the no-API fallback, checked in full first.
 * A platform that is not configured is "Not configured" and is never called.
 * An empty period reports "No data", never zero spend.
 */
export const SPEND_PLATFORMS = ['google_ads', 'meta'] as const;
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface SpendReport {
  from: string;
  to: string;
  rows: SpendReportRow[];
  /** Per currency: never a cross-currency sum. Empty = No data. */
  totals: Array<{ currency: string; spendMinor: number; clicks: number | null; impressions: number | null }>;
}

export class AdSpendUseCases {
  constructor(
    private readonly repo: SpendFactRepository,
    private readonly gateway: SpendGateway,
    private readonly capability: (platform: string) => Promise<CapabilityView | null>,
    private readonly credentials: (platform: string) => Promise<PlatformCredentials>,
    private readonly audit: CreateAuditLogUseCase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Pull one platform's daily spend for [from, to]. */
  async importFromApi(platform: string, trigger: 'ADMIN' | 'SCHEDULE', actorId: string | null, range?: { from?: string; to?: string }): Promise<SpendImportRecord> {
    const startedAt = this.now();
    const to = range?.to && /^\d{4}-\d{2}-\d{2}$/.test(range.to) ? range.to : iso(new Date(startedAt.getTime() - DAY));
    const from = range?.from && /^\d{4}-\d{2}-\d{2}$/.test(range.from) ? range.from : iso(new Date(new Date(`${to}T00:00:00Z`).getTime() - 6 * DAY));
    const rec = (status: string, rowsWritten: number, message: string | null): SpendImportRecord => ({ platform, trigger, status, dateFrom: from, dateTo: to, rowsWritten, message, actorId, startedAt });
    const done = async (r: SpendImportRecord) => { await this.repo.recordImport(r); return r; };
    if (!(SPEND_PLATFORMS as readonly string[]).includes(platform)) return done(rec('NOT_AVAILABLE', 0, 'Spend import by API is built for Google Ads and Meta; use the CSV upload for other platforms.'));
    if (from > to || new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime() > 90 * DAY) return done(rec('BAD_RANGE', 0, 'Choose a range of at most 90 days, start before end.'));
    if (!(await this.capability(platform))) return done(rec('NOT_CONFIGURED', 0, 'Not configured: spend import for this platform is not set up and switched on.'));
    let facts: SpendFact[];
    try {
      facts = await this.gateway.fetchDaily(platform, from, to, await this.credentials(platform));
    } catch (err) {
      return done(rec('FAILED', 0, String((err as Error).message ?? err).slice(0, 400)));
    }
    const bad = facts.map((f) => spendFactErrors(f, this.now())).filter((e) => e.length);
    if (bad.length) return done(rec('REFUSED', 0, `The platform returned ${bad.length} row(s) that are not valid spend facts (${bad[0].join('; ')}). Nothing was written.`));
    if (facts.length === 0) return done(rec('NO_DATA', 0, 'The platform reported no campaign activity in this range.'));
    const conflict = currencyConflict(facts, await this.repo.ingestedCurrencies());
    if (conflict) return done(rec('REFUSED', 0, conflict));
    const { written } = await this.repo.upsert(facts, actorId);
    return done(rec('IMPORTED', written, null));
  }

  async importScheduled(): Promise<SpendImportRecord[]> {
    const out: SpendImportRecord[] = [];
    for (const p of SPEND_PLATFORMS) if (await this.capability(p)) out.push(await this.importFromApi(p, 'SCHEDULE', null));
    return out;
  }

  /** The CSV fallback: validate the whole file; dry run shows the plan; apply writes all or nothing. */
  async importCsv(actorId: string | null, csv: string, dryRun: boolean): Promise<{ ok: boolean; dryRun: boolean; rows: number; added: number; changed: number; unchanged: number; errors: Array<{ rowNumber: number; errors: string[] }> }> {
    const empty = { added: 0, changed: 0, unchanged: 0 };
    if (typeof csv !== 'string' || !csv.trim()) return { ok: false, dryRun, rows: 0, ...empty, errors: [{ rowNumber: 0, errors: ['the file is empty'] }] };
    if (csv.length > 2_000_000) return { ok: false, dryRun, rows: 0, ...empty, errors: [{ rowNumber: 0, errors: ['the file is larger than 2 MB'] }] };
    const parsed = parseSpendCsv(csv, this.now());
    if (parsed.errors.length) return { ok: false, dryRun, rows: 0, ...empty, errors: parsed.errors };
    // Spend a LIVE API import already brings in would be counted twice.
    const apiLive = new Set<string>();
    for (const p of SPEND_PLATFORMS) if (await this.capability(p)) apiLive.add(p);
    const doubled = parsed.facts.map((f, i) => ({ f, i })).filter(({ f }) => { const k = apiPlatformOf(f.platform); return k !== null && apiLive.has(k); });
    if (doubled.length) {
      return { ok: false, dryRun, rows: parsed.facts.length, ...empty, errors: doubled.slice(0, 50).map(({ f }) => ({ rowNumber: 0, errors: [`${f.platform} spend is imported by API every day; a CSV would count ${f.spendDate} twice. Remove these rows or switch the API import off.`] })) };
    }
    const conflict = currencyConflict(parsed.facts, await this.repo.ingestedCurrencies());
    if (conflict) return { ok: false, dryRun, rows: parsed.facts.length, ...empty, errors: [{ rowNumber: 0, errors: [conflict] }] };
    const plan = await this.repo.preview(parsed.facts);
    if (dryRun) return { ok: true, dryRun, rows: parsed.facts.length, ...plan, errors: [] };
    const startedAt = this.now();
    const { written } = await this.repo.upsert(parsed.facts, actorId);
    const days = parsed.facts.map((f) => f.spendDate).sort();
    await this.repo.recordImport({ platform: [...new Set(parsed.facts.map((f) => f.platform))].join(', ').slice(0, 32), trigger: 'CSV', status: 'IMPORTED', dateFrom: days[0], dateTo: days[days.length - 1], rowsWritten: written, message: null, actorId, startedAt });
    await this.audit.execute({ actorId, action: 'AD_SPEND_CSV_IMPORTED', entity: 'media_cost_fact', entityId: `csv:${days[0]}:${days[days.length - 1]}`, newState: { rows: parsed.facts.length, ...plan } });
    return { ok: true, dryRun, rows: parsed.facts.length, ...plan, errors: [] };
  }

  async report(from?: string, to?: string): Promise<SpendReport> {
    const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : iso(this.now());
    const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : iso(new Date(new Date(`${t}T00:00:00Z`).getTime() - 29 * DAY));
    const rows = await this.repo.report(f, t);
    return { from: f, to: t, rows, totals: spendTotals(rows) };
  }

  recentImports(limit = 20) { return this.repo.recentImports(limit); }
}

/**
 * Totals per currency (never across currencies). A click or impression total
 * is stated only when EVERY row in that currency states it; one unknown count
 * makes the total unknown (null), never a smaller number that looks complete.
 */
export function spendTotals(rows: SpendReportRow[]): SpendReport['totals'] {
  const cur = [...new Set(rows.map((r) => r.currency))].sort();
  return cur.map((currency) => {
    const rs = rows.filter((r) => r.currency === currency);
    const sum = (k: 'clicks' | 'impressions') => (rs.every((r) => r[k] != null) ? rs.reduce((s, r) => s + (r[k] as number), 0) : null);
    return { currency, spendMinor: rs.reduce((s, r) => s + r.spendMinor, 0), clicks: sum('clicks'), impressions: sum('impressions') };
  });
}

/** Which API-imported platform a CSV platform name means, if any. */
export function apiPlatformOf(platform: string): 'google_ads' | 'meta' | null {
  const p = platform.trim().toLowerCase();
  if (/^google( ads)?$|adwords/.test(p)) return 'google_ads';
  if (/^(meta|facebook|instagram)( ads)?$/.test(p)) return 'meta';
  return null;
}
