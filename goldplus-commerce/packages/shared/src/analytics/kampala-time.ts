/**
 * Kampala-time period service.
 *
 * Analytics periods are Africa/Kampala calendar days, but every database
 * comparison uses exact UTC instants derived from those local days. The
 * previous model constructed boundaries with Date.UTC while labelling them
 * "Africa/Kampala", which shifted every day boundary by three hours: an order
 * placed 21:30 UTC (00:30 Kampala, next day) landed in the wrong bucket.
 *
 * Uganda does not observe daylight-saving time, so the offset is a constant
 * +03:00 in practice — but the offset is still derived from the named IANA
 * timezone via Intl, never hard-coded, and re-derived once across the boundary
 * so a historical or future offset change cannot silently corrupt buckets.
 */

export const ANALYTICS_TIMEZONE = 'Africa/Kampala';

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface AnalyticsPeriod {
  /** Inclusive UTC instant of 00:00:00.000 on the first Kampala day. */
  start: Date;
  /** Inclusive UTC instant of 23:59:59.999 on the last Kampala day. */
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  /** Kampala calendar days in the period (comparison window is the same length). */
  days: number;
  /** First and last Kampala calendar day, as YYYY-MM-DD. */
  startDay: string;
  endDay: string;
  previousStartDay: string;
  previousEndDay: string;
  timezone: typeof ANALYTICS_TIMEZONE;
}

/** Milliseconds the zone is ahead of UTC at the given instant. */
export function timezoneOffsetMs(timeZone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) parts[part.type] = part.value;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl emits hour 24 for midnight in some environments.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - at.getTime();
}

function parseIsoDay(day: string): { y: number; m: number; d: number } {
  if (!ISO_DAY.test(day)) throw new Error(`INVALID_DAY:${day}`);
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new Error(`INVALID_DAY:${day}`);
  }
  return { y, m, d };
}

/** UTC instant of 00:00:00.000 on the given Kampala calendar day. */
export function kampalaDayStartUtc(day: string): Date {
  const { y, m, d } = parseIsoDay(day);
  const localAsUtc = Date.UTC(y, m - 1, d);
  const firstGuess = new Date(localAsUtc - timezoneOffsetMs(ANALYTICS_TIMEZONE, new Date(localAsUtc)));
  // One refinement pass in case the offset differs at the true instant.
  const refined = localAsUtc - timezoneOffsetMs(ANALYTICS_TIMEZONE, firstGuess);
  return new Date(refined);
}

/** UTC instant of 23:59:59.999 on the given Kampala calendar day. */
export function kampalaDayEndUtc(day: string): Date {
  const { y, m, d } = parseIsoDay(day);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const next = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
  return new Date(kampalaDayStartUtc(next).getTime() - 1);
}

/** The Kampala calendar day (YYYY-MM-DD) an instant falls on. */
export function kampalaDayOf(instant: Date): string {
  const shifted = new Date(instant.getTime() + timezoneOffsetMs(ANALYTICS_TIMEZONE, instant));
  return shifted.toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  const { y, m, d } = parseIsoDay(day);
  const moved = new Date(Date.UTC(y, m - 1, d + delta));
  return moved.toISOString().slice(0, 10);
}

function dayCountInclusive(startDay: string, endDay: string): number {
  const start = parseIsoDay(startDay);
  const end = parseIsoDay(endDay);
  const diff = Date.UTC(end.y, end.m - 1, end.d) - Date.UTC(start.y, start.m - 1, start.d);
  return Math.round(diff / DAY_MS) + 1;
}

export const MAX_ANALYTICS_PERIOD_DAYS = 366;

/**
 * Resolve the analytics period from operator input.
 *
 * The comparison window is the same number of Kampala days immediately before
 * the current window, never overlapping it.
 */
export function resolveKampalaPeriod(input: {
  startDate?: string | null;
  endDate?: string | null;
  days?: number | null;
  now?: Date;
}): AnalyticsPeriod {
  const now = input.now ?? new Date();
  const requestedDays = Math.max(1, Math.min(MAX_ANALYTICS_PERIOD_DAYS, Math.trunc(input.days ?? 30)));

  const endDay = input.endDate && ISO_DAY.test(input.endDate) ? input.endDate : kampalaDayOf(now);
  const startDay = input.startDate && ISO_DAY.test(input.startDate)
    ? input.startDate
    : addDays(endDay, -(requestedDays - 1));

  if (startDay > endDay) throw new Error('END_BEFORE_START');
  const days = dayCountInclusive(startDay, endDay);
  if (days > MAX_ANALYTICS_PERIOD_DAYS) throw new Error('PERIOD_TOO_LONG');

  const previousEndDay = addDays(startDay, -1);
  const previousStartDay = addDays(previousEndDay, -(days - 1));

  return {
    start: kampalaDayStartUtc(startDay),
    end: kampalaDayEndUtc(endDay),
    previousStart: kampalaDayStartUtc(previousStartDay),
    previousEnd: kampalaDayEndUtc(previousEndDay),
    days,
    startDay,
    endDay,
    previousStartDay,
    previousEndDay,
    timezone: ANALYTICS_TIMEZONE,
  };
}
