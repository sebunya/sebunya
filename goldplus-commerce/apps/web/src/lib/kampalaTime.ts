/**
 * Admin date-time inputs are Kampala wall-clock time.
 *
 * A `<input type="datetime-local">` value ('2026-10-01T09:00') carries no zone.
 * The web container runs in UTC, so `new Date(value)` read it as 09:00Z =
 * 12:00 in Kampala: scheduled legal publications, recommendation rules and
 * automation approvals all took effect three hours late, while the page echoed
 * back the typed time and hid the shift. Uganda is UTC+3 all year (no DST).
 */
import { kampalaWallTimeToIso } from './pricingVersionDraft';

/**
 * A datetime-local value (or any ISO string) → a Date, reading zone-less input
 * as Kampala time. The offset rule is the one pricing already uses
 * (kampalaWallTimeToIso), so there is one rule, not two.
 */
export function parseKampalaLocal(value: string | null | undefined): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const d = new Date(kampalaWallTimeToIso(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO instant for the API, or null when the input is empty or unparseable. */
export function kampalaLocalToIso(value: string | null | undefined): string | null {
  return parseKampalaLocal(value)?.toISOString() ?? null;
}

/** An instant shown as Kampala wall-clock 'YYYY-MM-DD HH:MM' (for display and datetime-local defaults use toKampalaInputValue). */
export function formatKampala(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(String(iso));
  if (Number.isNaN(d.getTime())) return '—';
  return toKampalaInputValue(d).replace('T', ' ');
}

/** 'YYYY-MM-DDTHH:MM' in Kampala time — the value a datetime-local input expects. */
export function toKampalaInputValue(d: Date): string {
  const k = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  return k.toISOString().slice(0, 16);
}
