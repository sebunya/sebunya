/**
 * Split a draft body into numbers and strings. A launch value can be a string (own_rider_max_band is 'B0'..'B6'), and
 * the expert form sends it inside `values`: a value that is not a number is kept as a string rather than dropped, so
 * the draft carries what the operator chose and the use case decides whether that key accepts it.
 */
export function splitDraftValues(rawValues: unknown, rawStrings: unknown): { values: Record<string, number>; stringValues: Record<string, string> } {
  const values: Record<string, number> = {};
  const stringValues: Record<string, string> = {};
  for (const [k, v] of Object.entries((rawValues ?? {}) as Record<string, unknown>)) {
    const text = String(v ?? '').trim();
    if (!text) continue;
    const parsed = Number(text.replace(/[,\s]/g, ''));
    if (Number.isFinite(parsed)) values[k] = parsed;
    else if (typeof v === 'string') stringValues[k] = text;
  }
  for (const [k, v] of Object.entries((rawStrings ?? {}) as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) stringValues[k] = v.trim();
  }
  return { values, stringValues };
}
