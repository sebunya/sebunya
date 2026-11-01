/**
 * The lifetime-points threshold typed into the tier form.
 *
 * Empty means "not set" (null). Anything that is not a whole number is refused:
 * "5k" used to become NaN, then null in JSON, and silently cleared the
 * threshold while the page reported "Tier saved".
 */
export function parseTierThreshold(raw: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  const text = String(raw ?? '').replace(/[,\s]/g, '');
  if (text === '') return { ok: true, value: null };
  if (!/^\d{1,12}$/.test(text)) {
    return { ok: false, message: 'The threshold must be a whole number of points, for example 5000. Nothing was saved.' };
  }
  return { ok: true, value: Number(text) };
}
