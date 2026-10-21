/**
 * Gift card occasions and the calendar that decides which come first (owner brief, 2026-10-21).
 *
 * ONE place for every occasion's id, normal order, dates, display window and priority. The storefront draws each
 * occasion (artwork, words); this decides only prominence. Every occasion is always selectable: the calendar moves
 * at most two seasonal ones into the first six, never removes anything, and never infers anything about the visitor
 * (no religion, relationship, parenthood or birthday from a name or profile): it reads the calendar and an owner's
 * explicit, time-boxed adjustments only.
 *
 * Dates are Kampala calendar days (YYYY-MM-DD). Pure: the caller passes "today".
 */

export const EVERYDAY_OCCASIONS = ['gold', 'birthday', 'thanks', 'celebrate', 'love', 'anniversary'] as const;
export const SEASONAL_OCCASIONS = ['valentine', 'mothers_day', 'fathers_day', 'easter', 'eid', 'christmas', 'new_year', 'festive'] as const;
export const GIFT_CARD_OCCASIONS = [...EVERYDAY_OCCASIONS, ...SEASONAL_OCCASIONS] as const;
export type GiftCardOccasion = (typeof GIFT_CARD_OCCASIONS)[number];
export const isGiftCardOccasion = (v: unknown): v is GiftCardOccasion => typeof v === 'string' && (GIFT_CARD_OCCASIONS as readonly string[]).includes(v);

/** Always in the first six, whatever the season. */
export const ALWAYS_SHOWN: readonly GiftCardOccasion[] = ['gold', 'birthday'];
export const FIRST_VIEW_SIZE = 6;
export const MAX_SEASONAL_IN_FIRST_VIEW = 2;

type DateRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nth_weekday'; month: number; weekday: number; n: number } // weekday 0 = Sunday
  | { kind: 'easter' } // Good Friday to Easter Monday (Western reckoning, as Uganda's public holidays)
  | { kind: 'configured' } // only dates an owner has entered (Eid: set by the moon, never guessed)
  | { kind: 'period'; from: string; to: string }; // MM-DD to MM-DD, may cross the new year; no single day

export interface SeasonalDefinition {
  id: GiftCardOccasion;
  rule: DateRule;
  /** Brought forward this many days before the celebration starts, through its last day. */
  daysBefore: number;
  /** Fixed tie-break: lower first. */
  priority: number;
}

/** The starting windows. Adjustable here, or per occasion from the admin settings (windowDays). */
export const SEASONAL_DEFINITIONS: readonly SeasonalDefinition[] = [
  { id: 'valentine', rule: { kind: 'fixed', month: 2, day: 14 }, daysBefore: 21, priority: 4 },
  // Uganda keeps the second Sunday of May and the third Sunday of June.
  { id: 'mothers_day', rule: { kind: 'nth_weekday', month: 5, weekday: 0, n: 2 }, daysBefore: 14, priority: 5 },
  { id: 'fathers_day', rule: { kind: 'nth_weekday', month: 6, weekday: 0, n: 3 }, daysBefore: 14, priority: 6 },
  { id: 'easter', rule: { kind: 'easter' }, daysBefore: 14, priority: 3 },
  { id: 'eid', rule: { kind: 'configured' }, daysBefore: 14, priority: 3 },
  { id: 'christmas', rule: { kind: 'fixed', month: 12, day: 25 }, daysBefore: 28, priority: 1 },
  { id: 'new_year', rule: { kind: 'fixed', month: 1, day: 1 }, daysBefore: 10, priority: 2 },
  { id: 'festive', rule: { kind: 'period', from: '12-01', to: '01-03' }, daysBefore: 0, priority: 7 },
];

/** What an owner may adjust (Admin > Gift cards > Occasions). Everything is optional and time-boxed. */
export interface OccasionSettings {
  /** Dates that cannot be computed (Eid al-Fitr, Eid al-Adha): entered once announced. */
  dates?: Array<{ occasion: GiftCardOccasion; start: string; end: string; label?: string }>;
  /** Bring forward earlier, or stop featuring, between two days. Never removes the occasion from the full list. */
  overrides?: Array<{ occasion: GiftCardOccasion; mode: 'feature' | 'hide'; from: string; to: string }>;
  /** A different "days before" for an occasion. */
  windowDays?: Partial<Record<GiftCardOccasion, number>>;
  /** Season's greetings period, MM-DD. */
  festivePeriod?: { from: string; to: string };
}

export interface OccasionOrder {
  /** The first six, in order. */
  featured: GiftCardOccasion[];
  /** Everything else, in normal order. */
  more: GiftCardOccasion[];
  /** Only when the dates support it. */
  labels: Partial<Record<GiftCardOccasion, 'Today' | 'Coming up'>>;
}

// ── Kampala calendar arithmetic on YYYY-MM-DD strings (UTC midnight stands for the Kampala day) ──────────────
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ymd = (y: number, m: number, d: number) => iso(new Date(Date.UTC(y, m - 1, d)));
export const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const kampalaDay = (now: Date) => iso(new Date(now.getTime() + 3 * 3_600_000));
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && iso(new Date(`${v}T00:00:00Z`)) === v;
const isMonthDay = (v: unknown): v is string => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);

/** Western Easter Sunday (anonymous Gregorian algorithm; exact for every Gregorian year). */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return ymd(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

/** The celebration spans (start..end, inclusive) of an occasion near `year`; [] when its dates are unknown. */
function spans(def: SeasonalDefinition, year: number, settings: OccasionSettings): Array<{ start: string; end: string; dated: boolean }> {
  const out: Array<{ start: string; end: string; dated: boolean }> = [];
  for (const y of [year - 1, year, year + 1]) {
    const r = def.rule;
    if (r.kind === 'fixed') { const d = ymd(y, r.month, r.day); out.push({ start: d, end: d, dated: true }); }
    else if (r.kind === 'nth_weekday') { const d = nthWeekday(y, r.month, r.weekday, r.n); out.push({ start: d, end: d, dated: true }); }
    else if (r.kind === 'easter') { const sun = easterSunday(y); out.push({ start: addDays(sun, -2), end: addDays(sun, 1), dated: true }); }
    else if (r.kind === 'period') {
      const p = def.id === 'festive' && settings.festivePeriod && isMonthDay(settings.festivePeriod.from) && isMonthDay(settings.festivePeriod.to) ? settings.festivePeriod : r;
      const start = `${y}-${p.from}`;
      const end = p.to >= p.from ? `${y}-${p.to}` : `${y + 1}-${p.to}`; // crosses the new year
      if (isDay(start) && isDay(end)) out.push({ start, end, dated: false });
    }
  }
  if (def.rule.kind === 'configured') {
    for (const d of settings.dates ?? []) {
      if (d.occasion === def.id && isDay(d.start) && isDay(d.end) && d.end >= d.start && daysBetween(d.start, d.end) <= 10) out.push({ start: d.start, end: d.end, dated: true });
    }
  }
  return out;
}

const activeOverride = (settings: OccasionSettings, id: GiftCardOccasion, today: string, mode: 'feature' | 'hide') =>
  (settings.overrides ?? []).some((o) => o.occasion === id && o.mode === mode && isDay(o.from) && isDay(o.to) && o.from <= today && today <= o.to);

/**
 * The order for a visitor opening the form today. Deterministic: same day + same settings = same order.
 *  1. Seasonal occasions whose window covers today (dates known, not hidden), plus any an owner features today.
 *  2. Ranked: happening today, then an owner's feature, then the nearest upcoming, then the fixed priority.
 *     An ongoing period with no single day (Season's greetings) ranks after dated ones.
 *  3. At most two join the first six, in front of A gift for you and Birthday; the everyday rest fill the six.
 */
export function orderOccasions(today: string, settings: OccasionSettings = {}): OccasionOrder {
  const year = Number(today.slice(0, 4));
  const candidates: Array<{ id: GiftCardOccasion; group: number; distance: number; priority: number; label: 'Today' | 'Coming up' | null }> = [];
  for (const def of SEASONAL_DEFINITIONS) {
    if (activeOverride(settings, def.id, today, 'hide')) continue;
    const before = Math.max(0, Math.min(60, Math.floor(settings.windowDays?.[def.id] ?? def.daysBefore)));
    const inWindow = spans(def, year, settings).find((s) => addDays(s.start, -before) <= today && today <= s.end);
    const featured = activeOverride(settings, def.id, today, 'feature');
    if (!inWindow && !featured) continue;
    const happening = Boolean(inWindow && inWindow.dated && inWindow.start <= today);
    const distance = inWindow ? (inWindow.dated ? Math.max(0, daysBetween(today, inWindow.start)) : 400) : 500;
    candidates.push({
      id: def.id, group: happening ? 0 : featured ? 1 : 2, distance, priority: def.priority,
      label: inWindow?.dated ? (happening ? 'Today' : 'Coming up') : null,
    });
  }
  candidates.sort((a, b) => a.group - b.group || a.distance - b.distance || a.priority - b.priority || a.id.localeCompare(b.id));
  const seasonal = candidates.slice(0, MAX_SEASONAL_IN_FIRST_VIEW);
  const featured: GiftCardOccasion[] = [...seasonal.map((c) => c.id)];
  for (const id of EVERYDAY_OCCASIONS) if (featured.length < FIRST_VIEW_SIZE) featured.push(id);
  for (const id of ALWAYS_SHOWN) if (!featured.includes(id)) featured.splice(FIRST_VIEW_SIZE - 1, 1, id); // never happens with 2 seasonal; a guard
  const more = GIFT_CARD_OCCASIONS.filter((id) => !featured.includes(id));
  const labels: OccasionOrder['labels'] = {};
  for (const c of seasonal) if (c.label) labels[c.id] = c.label;
  return { featured, more, labels };
}

/** Validate what an owner saves. Returns clean settings or the first problem, in words. */
export function checkOccasionSettings(input: unknown): { ok: true; value: OccasionSettings } | { ok: false; message: string } {
  const v = (input ?? {}) as Record<string, unknown>;
  const out: OccasionSettings = { dates: [], overrides: [] };
  for (const d of Array.isArray(v.dates) ? v.dates : []) {
    const r = d as Record<string, unknown>;
    if (!isGiftCardOccasion(r.occasion) || SEASONAL_DEFINITIONS.find((s) => s.id === r.occasion)?.rule.kind !== 'configured') return { ok: false, message: 'Dates can be entered only for occasions whose dates change each year (Eid).' };
    if (!isDay(r.start) || !isDay(r.end) || r.end < r.start || daysBetween(r.start, r.end) > 10) return { ok: false, message: `Check the dates for ${r.occasion}: start and end as YYYY-MM-DD, at most 10 days apart.` };
    out.dates!.push({ occasion: r.occasion, start: r.start, end: r.end, label: typeof r.label === 'string' ? r.label.slice(0, 40) : undefined });
  }
  for (const o of Array.isArray(v.overrides) ? v.overrides : []) {
    const r = o as Record<string, unknown>;
    if (!isGiftCardOccasion(r.occasion) || (r.mode !== 'feature' && r.mode !== 'hide')) return { ok: false, message: 'Each adjustment needs an occasion and "feature" or "hide".' };
    if (!isDay(r.from) || !isDay(r.to) || r.to < r.from) return { ok: false, message: `Check the dates of the ${r.occasion} adjustment: from and to as YYYY-MM-DD.` };
    if (daysBetween(r.from, r.to) > 90) return { ok: false, message: 'An adjustment can last at most 90 days, so nothing stays featured by accident.' };
    out.overrides!.push({ occasion: r.occasion, mode: r.mode, from: r.from, to: r.to });
  }
  if (v.windowDays && typeof v.windowDays === 'object') {
    out.windowDays = {};
    for (const [k, n] of Object.entries(v.windowDays as Record<string, unknown>)) {
      if (!isGiftCardOccasion(k) || !Number.isInteger(n) || (n as number) < 0 || (n as number) > 60) return { ok: false, message: 'A window is a whole number of days from 0 to 60.' };
      out.windowDays[k] = n as number;
    }
  }
  if (v.festivePeriod) {
    const p = v.festivePeriod as Record<string, unknown>;
    if (!isMonthDay(p.from) || !isMonthDay(p.to)) return { ok: false, message: "Season's greetings period: from and to as MM-DD." };
    out.festivePeriod = { from: p.from, to: p.to };
  }
  return { ok: true, value: out };
}
