/**
 * Marketing mix modelling readiness (2026-10-23). The same rules as ops/mmm/goldplus_mmm/readiness.py, so the admin
 * page and the Python package never disagree about whether a model is worth fitting. The daily rows are the shop's
 * own measurement.mmm_daily table; weeks are ISO weeks (Monday start) and incomplete first/last weeks are dropped.
 */
export interface MmmDailyRow { day: string; channel: string; spendMinor: bigint | number; orders: number; revenueMinor: bigint | number }
export interface WeeklyRow { weekStart: string; revenueMinor: number; orders: number; spendByChannel: Record<string, number> }
export interface ReadinessReport {
  ok: boolean;
  reasons: string[];
  stats: { weeks: number; mediaChannels: string[]; meanWeeklyOrders: number; totalSpendMinor: number; maxWeekSpendShare: number; spendCoverage: Record<string, number>; spendCv: Record<string, number> };
}
export const PREFERRED_WEEKS = 52;
export const MIN_WEEKS = 26;
export const MIN_SPEND_COVERAGE = 0.2;
export const MIN_SPEND_CV = 0.3;
export const MIN_MEAN_WEEKLY_ORDERS = 10;
export const MAX_WEEK_SPEND_SHARE = 0.4;

function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
}

export function toWeekly(rows: MmmDailyRow[]): WeeklyRow[] {
  if (!rows.length) return [];
  const days = rows.map((r) => r.day).sort();
  const first = days[0], last = days[days.length - 1];
  const weeks = new Map<string, WeeklyRow & { days: Set<string> }>();
  for (const r of rows) {
    const w = mondayOf(r.day);
    let row = weeks.get(w);
    if (!row) { row = { weekStart: w, revenueMinor: 0, orders: 0, spendByChannel: {}, days: new Set() }; weeks.set(w, row); }
    row.days.add(r.day);
    row.revenueMinor += Number(r.revenueMinor);
    row.orders += r.orders;
    const s = Number(r.spendMinor);
    if (s > 0) row.spendByChannel[r.channel] = (row.spendByChannel[r.channel] ?? 0) + s;
  }
  // A week is complete when its Monday is on/after the first day and its Sunday on/before the last day.
  return [...weeks.values()]
    .filter((w) => w.weekStart >= mondayOf(first) && (w.weekStart > first || w.weekStart === first) && new Date(`${w.weekStart}T00:00:00Z`).getTime() + 6 * 86_400_000 <= new Date(`${last}T00:00:00Z`).getTime() && w.weekStart >= first)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map(({ days: _d, ...w }) => w);
}

export function readiness(weekly: WeeklyRow[]): ReadinessReport {
  const reasons: string[] = [];
  const weeks = weekly.length;
  const channels = new Set<string>();
  for (const w of weekly) for (const c of Object.keys(w.spendByChannel)) channels.add(c);
  const media = [...channels].sort();
  const totalSpend = weekly.reduce((a, w) => a + Object.values(w.spendByChannel).reduce((x, y) => x + y, 0), 0);
  const meanOrders = weeks ? weekly.reduce((a, w) => a + w.orders, 0) / weeks : 0;
  const coverage: Record<string, number> = {};
  const cv: Record<string, number> = {};
  for (const c of media) {
    const series = weekly.map((w) => w.spendByChannel[c] ?? 0);
    coverage[c] = series.filter((v) => v > 0).length / weeks;
    const mean = series.reduce((a, b) => a + b, 0) / weeks;
    const sd = Math.sqrt(series.reduce((a, v) => a + (v - mean) ** 2, 0) / weeks);
    cv[c] = mean > 0 ? sd / mean : 0;
  }
  const maxShare = totalSpend > 0 ? Math.max(...weekly.map((w) => Object.values(w.spendByChannel).reduce((x, y) => x + y, 0) / totalSpend)) : 0;
  if (weeks < MIN_WEEKS) reasons.push(`Only ${weeks} complete week(s) of data; the hard minimum is ${MIN_WEEKS} and ${PREFERRED_WEEKS} or more is preferred.`);
  else if (weeks < PREFERRED_WEEKS) reasons.push(`${weeks} complete weeks of data; results will be weak until there are ${PREFERRED_WEEKS} or more.`);
  if (media.length === 0) reasons.push('No media channel has ever had spend; an MMM would return its priors only.');
  else {
    const usable = media.filter((c) => coverage[c] >= MIN_SPEND_COVERAGE && cv[c] >= MIN_SPEND_CV);
    if (usable.length === 0) reasons.push(`No media channel has spend in at least ${Math.round(MIN_SPEND_COVERAGE * 100)}% of weeks with enough week-to-week variation (coefficient of variation ${MIN_SPEND_CV} or more): ` + media.map((c) => `${c} covers ${Math.round(coverage[c] * 100)}% of weeks, variation ${cv[c].toFixed(2)}`).join('; ') + '.');
  }
  if (meanOrders < MIN_MEAN_WEEKLY_ORDERS) reasons.push(`Mean weekly orders ${meanOrders.toFixed(1)}; the model needs at least ${MIN_MEAN_WEEKLY_ORDERS} a week to separate signal from noise.`);
  if (maxShare > MAX_WEEK_SPEND_SHARE) reasons.push(`One week holds ${Math.round(maxShare * 100)}% of all spend; a single burst cannot be told apart from everything else that happened that week.`);
  const hard = reasons.filter((r) => !r.startsWith(`${weeks} complete weeks of data; results will be weak`));
  return { ok: hard.length === 0, reasons, stats: { weeks, mediaChannels: media, meanWeeklyOrders: meanOrders, totalSpendMinor: totalSpend, maxWeekSpendShare: maxShare, spendCoverage: coverage, spendCv: cv } };
}
