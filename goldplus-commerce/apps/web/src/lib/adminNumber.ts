/**
 * A number an operator typed into an admin form. Thousands separators ("1,200", "1 200") are fine; anything else that
 * is not a finite number ("5k", "UGX 5000", blank) is refused, never sent as NaN (which JSON turns into null, and the
 * API would read null as "no value").
 */
export function parseAdminNumber(raw: unknown): { ok: true; value: number } | { ok: false } {
  const text = String(raw ?? '').trim().replace(/[,\s ]/g, '');
  if (!text || !/^-?\d+(\.\d+)?$/.test(text)) return { ok: false };
  const value = Number(text);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}
