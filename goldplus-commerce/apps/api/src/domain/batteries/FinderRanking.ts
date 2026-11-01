import { normaliseDeviceToken } from '../products/Devices';
import { batteryCodeCandidates, normaliseBatteryCode } from './BatteryCodes';

/**
 * Universal search ranking. Pure domain. Exact matches resolve; prefix and
 * fuzzy matches only SUGGEST. A suggestion never becomes a compatibility fact.
 *
 * Priority: barcode / canonical code, supplier code, exact model number, exact
 * marketing name, exact alias, prefix, controlled fuzzy.
 */

export interface DeviceCandidate {
  id: string;
  brandNormalised: string;
  modelNormalised: string;
  modelNumberNormalised: string | null;
  variantNormalised: string | null;
  aliasesNormalised: string[];
  brandAliasesNormalised: string[];
  status: string;
}

export interface BatteryCandidate {
  productId: string;
  canonicalCodeNormalised: string;
  supplierCodeNormalised: string | null;
  barcode: string | null;
  aliasesNormalised: string[];
  lifecycleStatus: string;
}

export type RankedMatch =
  | { kind: 'BATTERY'; productId: string; tier: 1 | 2 | 5 | 6 | 7 }
  | { kind: 'DEVICE'; deviceId: string; tier: 3 | 4 | 5 | 6 | 7 };

/** Strip the brand from the front of a query so "Tecno Spark 7" matches model "Spark 7" under brand "tecno". */
function stripBrand(q: string, brands: string[]): { q: string; brand: string | null } {
  for (const b of brands) {
    if (b && q.startsWith(`${b} `)) return { q: q.slice(b.length + 1).trim(), brand: b };
    if (b && q === b) return { q: '', brand: b };
  }
  return { q, brand: null };
}

export interface RankInput {
  query: string;
  devices: DeviceCandidate[];
  batteries: BatteryCandidate[];
  /** Trigram similarity provided by the repository for fuzzy suggestions (id → score 0..1). */
  fuzzyDevices?: Array<{ id: string; score: number }>;
  fuzzyBatteries?: Array<{ productId: string; score: number }>;
}

export const FUZZY_MIN_SCORE = 0.35;
export const MAX_SUGGESTIONS = 8;

export function rankSearch(input: RankInput): RankedMatch[] {
  const raw = input.query.trim();
  if (!raw) return [];
  const out: RankedMatch[] = [];
  const seen = new Set<string>();
  const push = (m: RankedMatch) => {
    const key = m.kind === 'BATTERY' ? `b:${m.productId}` : `d:${m.deviceId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };

  const activeBatteries = input.batteries.filter((b) => b.lifecycleStatus !== 'ARCHIVED');
  const activeDevices = input.devices.filter((d) => d.status === 'ACTIVE');

  // Tier 1: barcode or canonical code (exact on candidate forms).
  const codeForms = batteryCodeCandidates(raw);
  const barcode = raw.replace(/\s+/g, '');
  for (const b of activeBatteries) {
    if (b.barcode && b.barcode === barcode) push({ kind: 'BATTERY', productId: b.productId, tier: 1 });
    else if (codeForms.includes(b.canonicalCodeNormalised)) push({ kind: 'BATTERY', productId: b.productId, tier: 1 });
  }
  // Tier 2: supplier part code.
  for (const b of activeBatteries) {
    if (b.supplierCodeNormalised && codeForms.includes(b.supplierCodeNormalised)) push({ kind: 'BATTERY', productId: b.productId, tier: 2 });
  }

  const qDev = normaliseDeviceToken(raw);
  const brands = Array.from(new Set(activeDevices.flatMap((d) => [d.brandNormalised, ...d.brandAliasesNormalised]))).sort((a, b) => b.length - a.length);
  const stripped = stripBrand(qDev, brands);
  const qModel = stripped.q;
  const qCode = normaliseBatteryCode(raw);

  const brandMatches = (d: DeviceCandidate) => !stripped.brand || d.brandNormalised === stripped.brand || d.brandAliasesNormalised.includes(stripped.brand);

  // Tier 3: exact device model number (normalised with either normaliser).
  for (const d of activeDevices) {
    if (!d.modelNumberNormalised) continue;
    if (d.modelNumberNormalised === qModel || normaliseBatteryCode(d.modelNumberNormalised) === qCode) {
      if (brandMatches(d)) push({ kind: 'DEVICE', deviceId: d.id, tier: 3 });
    }
  }
  // Tier 4: exact marketing name (with or without the brand in front).
  if (qModel) {
    for (const d of activeDevices) {
      const full = `${d.brandNormalised} ${d.modelNormalised}`.trim();
      const withNumber = d.modelNumberNormalised ? `${d.modelNormalised} ${d.modelNumberNormalised}` : null;
      if ((d.modelNormalised === qModel && brandMatches(d)) || full === qDev || withNumber === qModel) push({ kind: 'DEVICE', deviceId: d.id, tier: 4 });
    }
  }
  // Tier 5: exact alias (battery alias forms, device aliases).
  for (const b of activeBatteries) {
    if (b.aliasesNormalised.some((a) => codeForms.includes(a))) push({ kind: 'BATTERY', productId: b.productId, tier: 5 });
  }
  if (qModel) {
    for (const d of activeDevices) {
      if (d.aliasesNormalised.some((a) => a === qModel || a === qDev) && brandMatches(d)) push({ kind: 'DEVICE', deviceId: d.id, tier: 5 });
    }
  }
  if (out.length) return out;

  // Tier 6: prefix (suggestions only).
  if (qCode.length >= 3) {
    for (const b of activeBatteries) {
      if (b.canonicalCodeNormalised.startsWith(qCode) || b.aliasesNormalised.some((a) => a.startsWith(qCode))) push({ kind: 'BATTERY', productId: b.productId, tier: 6 });
    }
  }
  if (qModel.length >= 3) {
    for (const d of activeDevices) {
      if (!brandMatches(d)) continue;
      if (d.modelNormalised.startsWith(qModel) || (d.modelNumberNormalised ?? '').startsWith(qModel) || d.aliasesNormalised.some((a) => a.startsWith(qModel))) {
        push({ kind: 'DEVICE', deviceId: d.id, tier: 6 });
      }
    }
  } else if (!qModel && stripped.brand) {
    // Brand alone: suggest that brand's devices.
    for (const d of activeDevices) if (brandMatches(d)) push({ kind: 'DEVICE', deviceId: d.id, tier: 6 });
  }
  // Tier 7: controlled fuzzy from the repository (trigram), bounded.
  for (const f of (input.fuzzyDevices ?? []).filter((f) => f.score >= FUZZY_MIN_SCORE).sort((a, b) => b.score - a.score)) {
    if (activeDevices.some((d) => d.id === f.id)) push({ kind: 'DEVICE', deviceId: f.id, tier: 7 });
  }
  for (const f of (input.fuzzyBatteries ?? []).filter((f) => f.score >= FUZZY_MIN_SCORE).sort((a, b) => b.score - a.score)) {
    if (activeBatteries.some((b) => b.productId === f.productId)) push({ kind: 'BATTERY', productId: f.productId, tier: 7 });
  }
  return out.slice(0, MAX_SUGGESTIONS);
}

/** Exact matches (tiers 1-5) resolve; 6-7 only suggest. */
export function isExactTier(tier: number): boolean {
  return tier <= 5;
}
