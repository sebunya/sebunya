/**
 * East Africa Time — a primitive, not a feature.
 *
 * The cutoff countdown, the delivery window, the Control Centre's scheduled
 * publish and every timestamp comparison in the delivery module sit on this.
 * Before it existed the codebase had no timezone handling at all, which is the
 * single most reliable way to break a same-day promise every day.
 *
 * WHY NO LIBRARY AND NO DST BRANCH
 * Uganda observes UTC+03:00 all year. It has never operated daylight saving.
 * So EAT is a fixed offset, and a fixed offset is exactly representable — no
 * tz database, no ambiguity windows, no "spring forward" edge cases. Encoding
 * that as a constant is more honest than pulling in a general-purpose library
 * whose complexity models a problem this locale does not have.
 *
 * Everything here is pure and deterministic: pass the instant in, get the EAT
 * answer out. Nothing reads the system clock or the host timezone, so a server
 * in any region computes an identical cutoff.
 */

/** Uganda is UTC+03:00 year-round. No daylight saving, ever. */
export const EAT_OFFSET_MINUTES = 180;
export const EAT_OFFSET_MS = EAT_OFFSET_MINUTES * 60_000;
export const EAT_LABEL = 'EAT';
export const EAT_IANA = 'Africa/Kampala';

/** The civil date-and-time in Kampala for a given instant. */
export interface EatParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday, in EAT — not in UTC. */
  weekday: number;
}

/**
 * Break an instant into Kampala civil time.
 *
 * Implemented by shifting the instant and then reading UTC components: adding
 * the offset makes the UTC calendar fields *be* the EAT calendar fields, which
 * avoids the host timezone influencing anything.
 */
export function toEatParts(instant: Date): EatParts {
  const shifted = new Date(instant.getTime() + EAT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };
}

/** The instant at which a given Kampala civil time occurs. */
export function fromEatParts(parts: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}): Date {
  const utcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return new Date(utcMs - EAT_OFFSET_MS);
}

/** The EAT calendar date as YYYY-MM-DD. */
export function eatDateString(instant: Date): string {
  const p = toEatParts(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Kampala clock time as HH:MM. */
export function eatTimeString(instant: Date): string {
  const p = toEatParts(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Human label, always carrying the zone so a reader is never guessing. */
export function formatEat(instant: Date): string {
  return `${eatDateString(instant)} ${eatTimeString(instant)} ${EAT_LABEL}`;
}

export function isEatWeekend(instant: Date): boolean {
  const d = toEatParts(instant).weekday;
  return d === 0 || d === 6;
}

/** Parse "HH:MM" into minutes from midnight, or null when it is not a real time. */
export function parseClockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export interface CutoffResult {
  /** The instant the cutoff falls on, in absolute time. */
  cutoffAt: Date;
  /** Milliseconds remaining. Zero once the cutoff has passed. */
  msRemaining: number;
  /** True while the order would still make today's dispatch. */
  beforeCutoff: boolean;
  /** The EAT date the cutoff belongs to. */
  eatDate: string;
}

/**
 * Same-day cutoff, evaluated in Kampala civil time.
 *
 * `cutoffClock` is "HH:MM" EAT. Returns today's cutoff while it is still
 * ahead, otherwise the next day's — so a countdown never shows a negative or
 * silently rolls to a date the customer did not expect. Weekend handling is
 * the caller's: `isEatWeekend` and `nextEatDispatchDay` exist for that, because
 * whether Saturday dispatches is an operating decision, not a time fact.
 */
export function sameDayCutoff(now: Date, cutoffClock: string): CutoffResult | null {
  const minutes = parseClockMinutes(cutoffClock);
  if (minutes === null) return null;
  const p = toEatParts(now);
  const todayCutoff = fromEatParts({
    year: p.year,
    month: p.month,
    day: p.day,
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
  });
  if (todayCutoff.getTime() > now.getTime()) {
    return {
      cutoffAt: todayCutoff,
      msRemaining: todayCutoff.getTime() - now.getTime(),
      beforeCutoff: true,
      eatDate: eatDateString(todayCutoff),
    };
  }
  // Past today's cutoff: the next one is tomorrow in EAT. Adding 24h to the
  // instant is safe precisely because the offset never shifts.
  const tomorrowCutoff = new Date(todayCutoff.getTime() + 86_400_000);
  return {
    cutoffAt: tomorrowCutoff,
    msRemaining: tomorrowCutoff.getTime() - now.getTime(),
    beforeCutoff: false,
    eatDate: eatDateString(tomorrowCutoff),
  };
}

/**
 * The next day on which dispatch happens, given which weekdays operate.
 * `operatingDays` is a set of EAT weekday numbers (0 = Sunday).
 */
export function nextEatDispatchDay(from: Date, operatingDays: ReadonlySet<number>): Date | null {
  if (operatingDays.size === 0) return null;
  for (let addDays = 0; addDays <= 7; addDays++) {
    const candidate = new Date(from.getTime() + addDays * 86_400_000);
    if (operatingDays.has(toEatParts(candidate).weekday)) return candidate;
  }
  return null;
}
