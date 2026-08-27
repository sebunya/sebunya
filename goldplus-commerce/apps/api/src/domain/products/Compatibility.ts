/**
 * Product compatibility domain (Slice 5). Pure — no Hono, Drizzle, adapters.
 *
 * Two sources of compatibility knowledge exist and are never conflated:
 *  1. Admin-DECLARED mappings (this module) — catalogue truth, shown on PDPs.
 *  2. The heuristic CompatibilityRuleService used only for recommendation
 *     ranking. Heuristics are never presented to customers as verified
 *     compatibility.
 *
 * Hard rule: unknown is not compatible.
 */

/** Structural shape of the recommendation heuristic's result — declared here
 *  so the domain never imports from the application layer. */
export interface HeuristicCompatibilitySignal {
  compatible: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  reasons: string[];
}

export const COMPATIBILITY_VERDICTS = ['exact', 'compatible', 'conditional', 'incompatible'] as const;
export type DeclaredVerdict = (typeof COMPATIBILITY_VERDICTS)[number];
export type CompatibilityVerdict = DeclaredVerdict | 'unknown';

export interface CompatibilityMapping {
  id: string;
  productId: string;
  targetProductId: string;
  verdict: DeclaredVerdict;
  /** Required when verdict is 'conditional' — states the condition plainly. */
  note: string | null;
  enabled: boolean;
}

export interface CompatibilityMappingInput {
  productId: string;
  targetProductId: string;
  verdict: DeclaredVerdict;
  note: string | null;
  enabled: boolean;
}

export type MappingValidation =
  | { ok: true; value: CompatibilityMappingInput }
  | { ok: false; code: string; message: string };

const MAX_NOTE = 300;

export function validateCompatibilityMapping(input: {
  productId?: unknown;
  targetProductId?: unknown;
  verdict?: unknown;
  note?: unknown;
  enabled?: unknown;
}): MappingValidation {
  const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
  const targetProductId = typeof input.targetProductId === 'string' ? input.targetProductId.trim() : '';
  if (!productId || !targetProductId) {
    return { ok: false, code: 'MISSING_PRODUCTS', message: 'Both productId and targetProductId are required.' };
  }
  if (productId === targetProductId) {
    return { ok: false, code: 'SELF_MAPPING', message: 'A product cannot be marked compatible with itself.' };
  }
  const verdict = typeof input.verdict === 'string' ? input.verdict : '';
  if (!(COMPATIBILITY_VERDICTS as readonly string[]).includes(verdict)) {
    return { ok: false, code: 'INVALID_VERDICT', message: "Verdict must be 'exact', 'compatible', 'conditional', or 'incompatible' — never 'unknown'." };
  }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, MAX_NOTE) : null;
  if (verdict === 'conditional' && !note) {
    return { ok: false, code: 'NOTE_REQUIRED', message: 'A conditional verdict must state its condition in the note.' };
  }
  return {
    ok: true,
    value: {
      productId,
      targetProductId,
      verdict: verdict as DeclaredVerdict,
      note,
      enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    },
  };
}

export interface ResolvedCompatibility {
  verdict: CompatibilityVerdict;
  source: 'declared' | 'heuristic' | 'none';
  note: string | null;
  reasons: string[];
}

/**
 * Declared mappings always win. A heuristic may only ever soften to
 * 'conditional' (never 'exact'), and no signal at all is 'unknown'.
 */
export function resolveCompatibility(
  declared: CompatibilityMapping | null,
  heuristic: HeuristicCompatibilitySignal | null
): ResolvedCompatibility {
  if (declared && declared.enabled) {
    return { verdict: declared.verdict, source: 'declared', note: declared.note, reasons: ['DECLARED_BY_ADMIN'] };
  }
  if (heuristic && heuristic.compatible && heuristic.confidence === 'HIGH') {
    return { verdict: 'compatible', source: 'heuristic', note: null, reasons: heuristic.reasons };
  }
  if (heuristic && heuristic.compatible && heuristic.confidence === 'MEDIUM') {
    return { verdict: 'conditional', source: 'heuristic', note: 'Category match. Confirm the connector type before buying.', reasons: heuristic.reasons };
  }
  return { verdict: 'unknown', source: 'none', note: null, reasons: [] };
}

/** Customer-facing labels — plain English, no overclaiming. */
export function verdictLabel(verdict: CompatibilityVerdict): string {
  switch (verdict) {
    case 'exact':
      return 'Exact fit';
    case 'compatible':
      return 'Compatible';
    case 'conditional':
      return 'Works with conditions';
    case 'incompatible':
      return 'Not compatible';
    default:
      return 'Compatibility not verified';
  }
}
