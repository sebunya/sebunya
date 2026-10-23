/**
 * Control series for marketing mix modelling (2026-10-23): the things that move sales and are not marketing.
 * Holidays and school terms are known in advance and never need a person; the rest (price index, stock-outs,
 * delivery-fee changes, mobile-money outages) are measured nightly or typed in by the owner.
 *
 * Dates are Kampala calendar days (UTC+3, no daylight saving). Movable Muslim holidays (Eid al-Fitr, Eid al-Adha)
 * follow moon sighting and are listed per year from the published gazette dates; a year not listed here gets no
 * Eid rows and the owner adds them by hand on the controls page.
 */
export const FIXED_PUBLIC_HOLIDAYS: ReadonlyArray<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 1, day: 26, name: 'NRM Liberation Day' },
  { month: 2, day: 16, name: 'Archbishop Janani Luwum Day' },
  { month: 3, day: 8, name: "International Women's Day" },
  { month: 5, day: 1, name: 'Labour Day' },
  { month: 6, day: 3, name: 'Martyrs Day' },
  { month: 6, day: 9, name: 'National Heroes Day' },
  { month: 10, day: 9, name: 'Independence Day' },
  { month: 12, day: 25, name: 'Christmas Day' },
  { month: 12, day: 26, name: 'Boxing Day' },
];

/** Gazetted Eid dates (Uganda). Extend each year; an unknown year is simply absent. */
export const EID_DATES: Readonly<Record<number, ReadonlyArray<{ date: string; name: string }>>> = {
  2025: [{ date: '2025-03-31', name: 'Eid al-Fitr' }, { date: '2025-06-06', name: 'Eid al-Adha' }],
  2026: [{ date: '2026-03-20', name: 'Eid al-Fitr' }, { date: '2026-05-27', name: 'Eid al-Adha' }],
  2027: [{ date: '2027-03-09', name: 'Eid al-Fitr' }, { date: '2027-05-16', name: 'Eid al-Adha' }],
};

/** Anonymous Gregorian algorithm: Easter Sunday for a year. */
export function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Every public holiday of a year as YYYY-MM-DD → name. */
export function publicHolidays(year: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of FIXED_PUBLIC_HOLIDAYS) out.set(iso(new Date(Date.UTC(year, h.month - 1, h.day))), h.name);
  const easter = easterSunday(year);
  out.set(iso(addDays(easter, -2)), 'Good Friday');
  out.set(iso(addDays(easter, 1)), 'Easter Monday');
  for (const e of EID_DATES[year] ?? []) out.set(e.date, e.name);
  return out;
}

/**
 * Ugandan school terms (Ministry of Education calendar, the same shape every year): term one from the first Monday
 * of February to early May, term two from late May to late August, term three from mid September to early December.
 * Exact dates shift by a few days a year; the model needs the shape (a long holiday in December and January, short
 * ones in May and August/September), not the day, so the approximation is documented and stable.
 */
export function inSchoolTerm(day: string): boolean {
  const [, m, d] = day.split('-').map(Number);
  const md = m * 100 + d;
  return (md >= 203 && md <= 508) || (md >= 526 && md <= 822) || (md >= 915 && md <= 1205);
}

export interface CalendarControls { holiday: 0 | 1; school_term: 0 | 1; holiday_name: string | null }

export function calendarControls(day: string): CalendarControls {
  const year = Number(day.slice(0, 4));
  const name = publicHolidays(year).get(day) ?? null;
  return { holiday: name ? 1 : 0, school_term: inSchoolTerm(day) ? 1 : 0, holiday_name: name };
}
