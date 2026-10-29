/**
 * GP-C08 was listed as 12W, but its own outputs are 5V⎓2A (10W) and 9V⎓1A (9W): at most 10W. The listing now says
 * 10W everywhere (name, descriptions, features, the "Output power" spec). Pure, so the rewrite is tested once and
 * scripts/correct-gp-c08-wattage.ts only reads and writes.
 */
export const GP_C08_SKU = 'GP-C08';

/** "12W" / "12 W" as a wattage (not 120W, not 12Wh), keeping the spacing the text used. */
export function rewriteTwelveWatts(text: string): string {
  return text.replace(/\b12( ?)W(?![a-z\d])/g, (_m, space: string) => `10${space}W`);
}

const isOutputPower = (name: unknown) => typeof name === 'string' && /^output power$/i.test(name.trim());

/** Every string rewritten; an "Output power" spec whose value is 12 (with a W unit) becomes 10. */
export function rewriteTwelveWattsDeep<T>(value: T): T {
  if (typeof value === 'string') return rewriteTwelveWatts(value) as T;
  if (Array.isArray(value)) return value.map((v) => rewriteTwelveWattsDeep(v)) as T;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (isOutputPower(k) && (v === 12 || v === '12')) out[k] = typeof v === 'number' ? 10 : '10';
      else out[k] = rewriteTwelveWattsDeep(v);
    }
    if (isOutputPower(o.name) && (o.value === 12 || o.value === '12')) out.value = typeof o.value === 'number' ? 10 : '10';
    return out as T;
  }
  return value;
}
