/**
 * Device catalogue domain (U2). Pure — no DB, no adapters.
 *
 * Normalisation makes lookups case/spacing/punctuation-insensitive WITHOUT
 * erasing the original display value (brand/model are stored verbatim; the
 * normalised forms live in separate columns). Alias resolution must surface
 * ambiguity rather than silently pick one model.
 */

export const DEVICE_FIT_TYPES = ['exact', 'universal', 'adapter_required'] as const;
export type DeviceFitType = (typeof DEVICE_FIT_TYPES)[number];

export const DEVICE_CONFIDENCE = ['verified', 'inferred', 'declared'] as const;
export type DeviceConfidence = (typeof DEVICE_CONFIDENCE)[number];

export const DEVICE_CONNECTOR_TYPES = ['usb_c', 'micro_usb', 'lightning', 'other'] as const;

/** Lower-case, collapse internal whitespace, drop punctuation that varies between
 * how people write a model ("Spark 20 Pro+" vs "spark-20 pro plus"). */
export function normaliseDeviceToken(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function deviceSlug(brand: string, model: string): string {
  const base = `${normaliseDeviceToken(brand)} ${normaliseDeviceToken(model)}`.trim();
  return base.replace(/\s+/g, '-').slice(0, 160);
}

export function normaliseAliases(aliases: string[]): string[] {
  const out = new Set<string>();
  for (const alias of aliases) {
    const n = normaliseDeviceToken(alias);
    if (n) out.add(n);
  }
  return Array.from(out);
}

export interface DeviceAliasCandidate {
  id: string;
  brandNormalised: string;
  modelNormalised: string;
  aliasesNormalised: string[];
  isActive: boolean;
}

export type AliasResolution =
  | { kind: 'RESOLVED'; deviceId: string }
  | { kind: 'NOT_FOUND' }
  | { kind: 'AMBIGUOUS'; deviceIds: string[] };

/**
 * Resolve a free-text device query ("charger for Tecno Spark 20" → "tecno spark
 * 20") to a single ACTIVE device. A query that matches more than one active
 * model is AMBIGUOUS — never silently resolved. Matching is against the model,
 * the full "brand model", and every alias.
 */
export function resolveDeviceQuery(query: string, candidates: DeviceAliasCandidate[]): AliasResolution {
  const q = normaliseDeviceToken(query);
  if (!q) return { kind: 'NOT_FOUND' };
  const matches = new Set<string>();
  for (const c of candidates) {
    if (!c.isActive) continue;
    const keys = [c.modelNormalised, `${c.brandNormalised} ${c.modelNormalised}`.trim(), ...c.aliasesNormalised];
    if (keys.some((key) => key && (key === q || q === key))) matches.add(c.id);
  }
  if (matches.size === 0) return { kind: 'NOT_FOUND' };
  if (matches.size === 1) return { kind: 'RESOLVED', deviceId: [...matches][0] };
  return { kind: 'AMBIGUOUS', deviceIds: [...matches].sort() };
}
