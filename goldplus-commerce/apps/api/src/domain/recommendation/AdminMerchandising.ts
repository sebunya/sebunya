/**
 * Admin "control room" domain — pure validation + merchandising application.
 *
 * Business users manage commercial rules (pin/boost/bury/exclude),
 * compatibility, and surface config here. Safety eligibility ALWAYS wins:
 * these functions can never make an unpublished, dealer-only, or
 * out-of-stock product appear on a public shelf.
 */
import { RankedCandidate } from './RecommendationV2';
import { RecommendationSignal, RecommendationSurface } from './RecommendationTypes';

// --------------------------------------------------------------------------
// Types (mirror the admin API contracts)
// --------------------------------------------------------------------------

export type MerchandisingAction = 'pin' | 'boost' | 'bury' | 'exclude';
export type MerchandisingScope = 'global' | 'surface' | 'category' | 'product' | 'anchor_product';

export interface AdminMerchandisingRule {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  action: MerchandisingAction;
  scope: MerchandisingScope;
  surface?: RecommendationSurface | null;
  productId?: string | null;
  categoryId?: string | null;
  anchorProductId?: string | null;
  weight?: number | null;
  priority: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  reason?: string | null;
}

export type CompatibilityRelationship =
  | 'compatible_accessory'
  | 'required_accessory'
  | 'optional_add_on'
  | 'substitute'
  | 'upgrade'
  | 'incompatible';

export interface AdminCompatibilityRule {
  id: string;
  anchorProductId?: string | null;
  anchorCategoryId?: string | null;
  candidateProductId?: string | null;
  candidateCategoryId?: string | null;
  relationship: CompatibilityRelationship;
  confidence: number;
  reasonText?: string | null;
  enabled: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface AdminSurfaceConfigInput {
  surface: RecommendationSurface;
  enabled: boolean;
  title: string;
  subtitle?: string | null;
  limit: number;
  minItems: number;
  hideIfBelowMinItems: boolean;
  hideIfOnlyFallback: boolean;
  showReasonTags: boolean;
  allowPageDuplicates: boolean;
  fallbackTitle?: string | null;
  fallbackChain: RecommendationSignal[];
  signalWeights: Partial<Record<RecommendationSignal, number>>;
  maxPerCategory?: number | null;
  maxPerBrand?: number | null;
  requiresPersonalization?: boolean;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

// --------------------------------------------------------------------------
// Validators
// --------------------------------------------------------------------------

const ALL_SIGNALS: RecommendationSignal[] = [
  'co_view', 'co_cart', 'co_purchase', 'user_view', 'user_cart', 'user_purchase',
  'trending', 'bestseller', 'new_arrival', 'campaign', 'metadata_similarity', 'compatibility', 'manual_merchandising',
];
const SIGNAL_SET = new Set<string>(ALL_SIGNALS);

export function validateSurfaceConfigInput(input: AdminSurfaceConfigInput): Validation<AdminSurfaceConfigInput> {
  const title = (input.title || '').trim();
  if (!title || title.length > 120) return { ok: false, code: 'BAD_TITLE', message: 'Shelf title is required (max 120 chars).' };
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    return { ok: false, code: 'BAD_LIMIT', message: 'Limit must be an integer between 1 and 50.' };
  }
  if (!Number.isInteger(input.minItems) || input.minItems < 0 || input.minItems > input.limit) {
    return { ok: false, code: 'BAD_MIN_ITEMS', message: 'minItems must be between 0 and the limit.' };
  }

  const weights = input.signalWeights ?? {};
  const entries = Object.entries(weights);
  let hasPositive = false;
  for (const [signal, w] of entries) {
    if (!SIGNAL_SET.has(signal)) return { ok: false, code: 'BAD_SIGNAL', message: `Unknown signal "${signal}".` };
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 10) {
      return { ok: false, code: 'BAD_WEIGHT', message: `Weight for "${signal}" must be a number between 0 and 10.` };
    }
    if (w > 0) hasPositive = true;
  }
  if (!hasPositive) return { ok: false, code: 'NO_SIGNALS', message: 'A surface must have at least one signal with a positive weight.' };

  if (!Array.isArray(input.fallbackChain) || input.fallbackChain.length === 0) {
    return { ok: false, code: 'NO_FALLBACK', message: 'A surface must define at least one fallback signal.' };
  }
  for (const f of input.fallbackChain) {
    if (!SIGNAL_SET.has(f)) return { ok: false, code: 'BAD_FALLBACK', message: `Unknown fallback signal "${f}".` };
  }
  return { ok: true, value: { ...input, title } };
}

export function validateMerchandisingRule(input: Partial<AdminMerchandisingRule>): Validation<Omit<AdminMerchandisingRule, 'id'>> {
  const name = (input.name || '').trim();
  if (!name) return { ok: false, code: 'BAD_NAME', message: 'Rule name is required.' };
  const action = input.action;
  if (action !== 'pin' && action !== 'boost' && action !== 'bury' && action !== 'exclude') {
    return { ok: false, code: 'BAD_ACTION', message: 'Action must be pin, boost, bury, or exclude.' };
  }
  const scope = input.scope;
  const validScopes: MerchandisingScope[] = ['global', 'surface', 'category', 'product', 'anchor_product'];
  if (!scope || !validScopes.includes(scope)) return { ok: false, code: 'BAD_SCOPE', message: 'Invalid scope.' };

  // Scope must carry the target it needs.
  if (scope === 'category' && !input.categoryId) return { ok: false, code: 'MISSING_CATEGORY', message: 'Category scope needs a categoryId.' };
  if (scope === 'anchor_product' && !input.anchorProductId) return { ok: false, code: 'MISSING_ANCHOR', message: 'Anchor scope needs an anchorProductId.' };
  // Pin/boost/bury/exclude on a product target need a productId.
  if ((action === 'pin' || action === 'boost' || action === 'bury' || action === 'exclude') && scope !== 'category' && scope !== 'global' && !input.productId) {
    return { ok: false, code: 'MISSING_PRODUCT', message: `A ${action} rule needs a productId.` };
  }

  if ((action === 'boost' || action === 'bury') && (typeof input.weight !== 'number' || input.weight <= 0 || input.weight > 5)) {
    return { ok: false, code: 'BAD_WEIGHT', message: 'Boost/bury weight must be a number between 0 (exclusive) and 5.' };
  }
  if (input.priority != null && (!Number.isInteger(input.priority) || input.priority < 0)) {
    return { ok: false, code: 'BAD_PRIORITY', message: 'Priority must be a non-negative integer.' };
  }
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    return { ok: false, code: 'BAD_WINDOW', message: 'endsAt must be after startsAt.' };
  }

  return {
    ok: true,
    value: {
      name,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      action,
      scope,
      surface: input.surface ?? null,
      productId: input.productId ?? null,
      categoryId: input.categoryId ?? null,
      anchorProductId: input.anchorProductId ?? null,
      weight: input.weight ?? null,
      priority: input.priority ?? 100,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      reason: input.reason ?? null,
    },
  };
}

export function validateCompatibilityRule(input: Partial<AdminCompatibilityRule>): Validation<Omit<AdminCompatibilityRule, 'id'>> {
  const rels: CompatibilityRelationship[] = ['compatible_accessory', 'required_accessory', 'optional_add_on', 'substitute', 'upgrade', 'incompatible'];
  if (!input.relationship || !rels.includes(input.relationship)) {
    return { ok: false, code: 'BAD_RELATIONSHIP', message: 'Invalid relationship type.' };
  }
  if (!input.anchorProductId && !input.anchorCategoryId) {
    return { ok: false, code: 'MISSING_ANCHOR', message: 'A compatibility rule needs an anchor product or category.' };
  }
  if (!input.candidateProductId && !input.candidateCategoryId) {
    return { ok: false, code: 'MISSING_CANDIDATE', message: 'A compatibility rule needs a candidate product or category.' };
  }
  const confidence = input.confidence ?? 1;
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    return { ok: false, code: 'BAD_CONFIDENCE', message: 'Confidence must be between 0 and 1.' };
  }
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    return { ok: false, code: 'BAD_WINDOW', message: 'endsAt must be after startsAt.' };
  }
  return {
    ok: true,
    value: {
      anchorProductId: input.anchorProductId ?? null,
      anchorCategoryId: input.anchorCategoryId ?? null,
      candidateProductId: input.candidateProductId ?? null,
      candidateCategoryId: input.candidateCategoryId ?? null,
      relationship: input.relationship,
      confidence,
      reasonText: input.reasonText ?? null,
      enabled: input.enabled ?? true,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    },
  };
}

// --------------------------------------------------------------------------
// Active-rule resolution + application
// --------------------------------------------------------------------------

/** Keeps only enabled rules inside their date window and matching the surface. */
export function resolveActiveRules(
  rules: AdminMerchandisingRule[],
  ctx: { surface: RecommendationSurface; now?: Date }
): AdminMerchandisingRule[] {
  const now = ctx.now ?? new Date();
  return rules.filter((r) => {
    if (!r.enabled) return false;
    if (r.startsAt && r.startsAt > now) return false;
    if (r.endsAt && r.endsAt <= now) return false;
    if (r.scope === 'surface' && r.surface && r.surface !== ctx.surface) return false;
    return true;
  });
}

export interface MerchandisingEffect {
  productId: string;
  action: MerchandisingAction | 'pin_blocked_by_safety';
  ruleId: string;
  ruleName: string;
  priority: number;
}

export interface MerchandisingResult {
  ranked: RankedCandidate[];
  /** Ordered product ids to pin at the front (already safety-checked). */
  pinnedProductIds: string[];
  effects: MerchandisingEffect[];
}

/**
 * Applies merchandising rules to a ranked list.
 *
 * Precedence (spec): safety eligibility > exclude > pin > boost/bury,
 * higher priority wins within an action. Excludes are removed; boosts/buries
 * adjust the final score; pins are surfaced first but only if `isSafe`.
 * Every decision is recorded in `effects` for the audit/preview panel.
 */
export function applyMerchandisingRules(
  ranked: RankedCandidate[],
  rules: AdminMerchandisingRule[],
  ctx: {
    categoryOf: (productId: string) => string | null | undefined;
    isSafe: (productId: string) => boolean;
    now?: Date;
  }
): MerchandisingResult {
  const effects: MerchandisingEffect[] = [];

  const matches = (rule: AdminMerchandisingRule, productId: string): boolean => {
    if (rule.productId) return rule.productId === productId;
    if (rule.scope === 'category' && rule.categoryId) return ctx.categoryOf(productId) === rule.categoryId;
    return false;
  };

  const rulesFor = (productId: string): AdminMerchandisingRule[] =>
    rules.filter((r) => matches(r, productId)).sort((a, b) => b.priority - a.priority);

  // 1. Excludes (highest precedence after safety).
  const excluded = new Set<string>();
  for (const r of rules) {
    if (r.action !== 'exclude') continue;
    for (const c of ranked) {
      if (matches(r, c.productId)) {
        excluded.add(c.productId);
        effects.push({ productId: c.productId, action: 'exclude', ruleId: r.id, ruleName: r.name, priority: r.priority });
      }
    }
  }

  // 2. Boost / bury on survivors.
  const survivors = ranked.filter((c) => !excluded.has(c.productId));
  for (const c of survivors) {
    const applicable = rulesFor(c.productId).filter((r) => r.action === 'boost' || r.action === 'bury');
    if (applicable.length === 0) continue;
    const top = applicable[0]; // highest priority wins
    const delta = (top.weight ?? 0) * (top.action === 'boost' ? 1 : -1);
    c.breakdown.campaignBoost = round(c.breakdown.campaignBoost + Math.max(delta, 0));
    c.breakdown.finalScore = round(Math.max(0, c.breakdown.finalScore + delta));
    effects.push({ productId: c.productId, action: top.action, ruleId: top.id, ruleName: top.name, priority: top.priority });
  }
  survivors.sort((a, b) => b.breakdown.finalScore - a.breakdown.finalScore || (a.productId < b.productId ? -1 : 1));

  // 3. Pins — front of the shelf, safety-checked, exclude wins over pin.
  const pins = rules
    .filter((r) => r.action === 'pin' && r.productId && !excluded.has(r.productId))
    .sort((a, b) => b.priority - a.priority);
  const pinnedProductIds: string[] = [];
  const pinnedSet = new Set<string>();
  for (const r of pins) {
    const pid = r.productId!;
    if (pinnedSet.has(pid)) continue;
    if (!ctx.isSafe(pid)) {
      effects.push({ productId: pid, action: 'pin_blocked_by_safety', ruleId: r.id, ruleName: r.name, priority: r.priority });
      continue;
    }
    pinnedSet.add(pid);
    pinnedProductIds.push(pid);
    effects.push({ productId: pid, action: 'pin', ruleId: r.id, ruleName: r.name, priority: r.priority });
  }

  // Remove pinned items from the algorithmic tail (they move to the front).
  const tail = survivors.filter((c) => !pinnedSet.has(c.productId));
  return { ranked: tail, pinnedProductIds, effects };
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
