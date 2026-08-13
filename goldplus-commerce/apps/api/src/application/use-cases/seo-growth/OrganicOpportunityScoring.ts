/**
 * Organic opportunity scoring — explainable, versioned, and honest about what
 * it does not know.
 *
 * Three rules govern this file:
 *
 * 1. UNKNOWN IS NOT ZERO. Search Console is not connected, so demand is
 *    genuinely unknown. Treating that as zero would rank every page at the
 *    bottom and make the whole engine lie. Missing evidence lowers CONFIDENCE
 *    and EVIDENCE_COMPLETENESS; it does not silently suppress a score.
 *
 * 2. NO OPAQUE NUMBER. Every score decomposes into named components carrying
 *    their raw evidence, normalised value, weight, contribution and reason
 *    code, so an operator can answer "why is this #1?" from the data alone.
 *
 * 3. BUSINESS VALUE OUTRANKS SEO VANITY. A high-demand cluster with a thin
 *    catalogue is not "index this now" — it is a catalogue-readiness
 *    opportunity. Readiness gates the recommendation, not just the score.
 */

export const SCORING_POLICY_VERSION = '1.0.0';

// ── Evidence ────────────────────────────────────────────────────────────────

export const EVIDENCE_STATES = ['KNOWN', 'UNKNOWN', 'PARTIAL', 'STALE', 'NOT_APPLICABLE'] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/** A measurement that knows whether it is real. */
export interface Evidenced<T> {
  value: T | null;
  state: EvidenceState;
  /** Where the value came from — provenance matters for conflict resolution. */
  source?: string;
  observedAt?: string;
}

export const known = <T>(value: T, source?: string): Evidenced<T> => ({ value, state: 'KNOWN', source });
export const unknown = <T>(source?: string): Evidenced<T> => ({ value: null, state: 'UNKNOWN', source });

export const EVIDENCE_DIMENSIONS = [
  'SEARCH_DEMAND', 'COMMERCE', 'TECHNICAL', 'CONTENT', 'LINK_GRAPH',
  'COMPETITOR', 'GA4', 'MERCHANT', 'GBP', 'CWV',
] as const;
export type EvidenceDimension = (typeof EVIDENCE_DIMENSIONS)[number];

export interface EvidenceCoverage {
  available: EvidenceDimension[];
  missing: EvidenceDimension[];
  notApplicable: EvidenceDimension[];
  /** Share of APPLICABLE dimensions that are available. Explicit, not a vibe. */
  completeness: number;
}

export function assessEvidenceCoverage(
  states: Partial<Record<EvidenceDimension, EvidenceState>>,
): EvidenceCoverage {
  const available: EvidenceDimension[] = [];
  const missing: EvidenceDimension[] = [];
  const notApplicable: EvidenceDimension[] = [];
  for (const dim of EVIDENCE_DIMENSIONS) {
    const s = states[dim] ?? 'UNKNOWN';
    if (s === 'NOT_APPLICABLE') notApplicable.push(dim);
    else if (s === 'KNOWN' || s === 'PARTIAL') available.push(dim);
    else missing.push(dim);
  }
  const applicable = available.length + missing.length;
  return {
    available,
    missing,
    notApplicable,
    completeness: applicable === 0 ? 0 : available.length / applicable,
  };
}

// ── Confidence ──────────────────────────────────────────────────────────────

export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export function assessConfidence(input: {
  coverage: EvidenceCoverage;
  /** Independent signals agreeing on the same conclusion. */
  confirmingSignals: number;
  /** Has the condition persisted across observations? */
  persistent: boolean;
  /** Any input older than its useful life. */
  stale: boolean;
}): Confidence {
  if (input.stale) return 'LOW';
  // Without search-demand evidence nothing about organic upside is high
  // confidence, however complete the rest of the picture is.
  const hasDemand = input.coverage.available.includes('SEARCH_DEMAND');
  if (!hasDemand) return input.coverage.completeness >= 0.5 && input.confirmingSignals >= 2 ? 'MEDIUM' : 'LOW';
  if (input.coverage.completeness >= 0.6 && input.confirmingSignals >= 2 && input.persistent) return 'HIGH';
  if (input.coverage.completeness >= 0.4) return 'MEDIUM';
  return 'LOW';
}

// ── Readiness ───────────────────────────────────────────────────────────────

export const COMMERCIAL_READINESS = [
  'READY', 'PARTIALLY_READY', 'CATALOGUE_THIN', 'OUT_OF_STOCK', 'LOW_STOCK',
  'PRICING_UNKNOWN', 'LIFECYCLE_BLOCKED', 'UNKNOWN',
] as const;
export type CommercialReadiness = (typeof COMMERCIAL_READINESS)[number];

export const SEO_BLOCKERS = [
  'NOINDEX', 'ROBOTS_BLOCK', 'WRONG_CANONICAL', 'CANONICAL_CONFLICT', 'REDIRECT',
  'HTTP_ERROR', 'SITEMAP_MISSING', 'ORPHAN', 'UNDERLINKED', 'CRAWL_DEPTH',
  'SCHEMA_INCOMPLETE', 'CONTENT_INCOMPLETE', 'LIFECYCLE_NOT_ELIGIBLE',
] as const;
export type SeoBlocker = (typeof SEO_BLOCKERS)[number];

export interface CommercialInput {
  eligibleProducts: Evidenced<number>;
  inStockProducts: Evidenced<number>;
  pricingComplete: Evidenced<boolean>;
  lifecycleBlocked: Evidenced<boolean>;
}

/** Minimum eligible products before a category page is commercially credible. */
export const CATALOGUE_DEPTH_FLOOR = 3;

export function assessCommercialReadiness(i: CommercialInput): {
  readiness: CommercialReadiness;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (i.lifecycleBlocked.state === 'KNOWN' && i.lifecycleBlocked.value === true) {
    return { readiness: 'LIFECYCLE_BLOCKED', reasons: ['The product lifecycle state blocks this page from owning demand.'] };
  }
  if (i.eligibleProducts.state !== 'KNOWN') {
    return { readiness: 'UNKNOWN', reasons: ['Catalogue depth is unknown, so commercial readiness cannot be judged.'] };
  }
  const eligible = i.eligibleProducts.value ?? 0;
  if (eligible === 0) return { readiness: 'CATALOGUE_THIN', reasons: ['No eligible products.'] };
  if (eligible < CATALOGUE_DEPTH_FLOOR) {
    reasons.push(`Only ${eligible} eligible product(s); ${CATALOGUE_DEPTH_FLOOR} is the floor for a credible category page.`);
    return { readiness: 'CATALOGUE_THIN', reasons };
  }
  const inStock = i.inStockProducts.state === 'KNOWN' ? (i.inStockProducts.value ?? 0) : null;
  if (inStock === 0) return { readiness: 'OUT_OF_STOCK', reasons: ['Every eligible product is out of stock.'] };
  if (inStock !== null && inStock < CATALOGUE_DEPTH_FLOOR) {
    reasons.push(`Only ${inStock} of ${eligible} products are in stock.`);
    return { readiness: 'LOW_STOCK', reasons };
  }
  if (i.pricingComplete.state === 'KNOWN' && i.pricingComplete.value === false) {
    return { readiness: 'PRICING_UNKNOWN', reasons: ['Some eligible products have no usable price.'] };
  }
  if (inStock === null) {
    reasons.push('Stock is unknown, so readiness is capped at partial.');
    return { readiness: 'PARTIALLY_READY', reasons };
  }
  return { readiness: 'READY', reasons: ['Catalogue depth, stock and pricing all support this page.'] };
}

export function assessSeoReadiness(blockers: SeoBlocker[]): {
  ready: boolean;
  blocking: SeoBlocker[];
  degrading: SeoBlocker[];
} {
  // Hard blockers make the page ineligible however valuable the demand is —
  // an opportunity must never be allowed to argue past an indexability gate.
  const HARD: SeoBlocker[] = ['NOINDEX', 'ROBOTS_BLOCK', 'HTTP_ERROR', 'WRONG_CANONICAL', 'CANONICAL_CONFLICT', 'REDIRECT', 'LIFECYCLE_NOT_ELIGIBLE'];
  const blocking = blockers.filter((b) => HARD.includes(b));
  return { ready: blocking.length === 0, blocking, degrading: blockers.filter((b) => !HARD.includes(b)) };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

export const SCORE_COMPONENTS = [
  'SEARCH_DEMAND', 'COMMERCIAL_INTENT', 'CURRENT_VISIBILITY', 'STRIKING_DISTANCE',
  'CTR_OPPORTUNITY', 'CATEGORY_PRIORITY', 'STOCK_CONFIDENCE', 'CATALOGUE_DEPTH',
  'SEO_READINESS', 'CONTENT_READINESS', 'INTERNAL_LINK_STRENGTH', 'COMPETITOR_GAP',
  'CONVERSION_SIGNAL', 'REVENUE_SIGNAL', 'MARGIN_SIGNAL',
] as const;
export type ScoreComponent = (typeof SCORE_COMPONENTS)[number];

export interface ComponentWeights {
  weights: Partial<Record<ScoreComponent, number>>;
  version: string;
}

/**
 * Governed weights. Commercial components deliberately outweigh raw demand:
 * a smaller in-stock, priced, conversion-ready opportunity should beat a large
 * informational cluster with nothing to sell.
 */
export const DEFAULT_WEIGHTS: ComponentWeights = {
  version: SCORING_POLICY_VERSION,
  weights: {
    SEARCH_DEMAND: 18,
    COMMERCIAL_INTENT: 20,
    CURRENT_VISIBILITY: 8,
    STRIKING_DISTANCE: 10,
    CTR_OPPORTUNITY: 6,
    CATEGORY_PRIORITY: 12,
    STOCK_CONFIDENCE: 10,
    CATALOGUE_DEPTH: 8,
    SEO_READINESS: 8,
    CONTENT_READINESS: 6,
    INTERNAL_LINK_STRENGTH: 4,
    COMPETITOR_GAP: 6,
    CONVERSION_SIGNAL: 12,
    REVENUE_SIGNAL: 14,
    MARGIN_SIGNAL: 8,
  },
};

export interface ScoredComponent {
  component: ScoreComponent;
  /** The raw evidence as observed — kept so the score can be re-derived. */
  raw: unknown;
  /** 0..1 after normalisation, or null when the evidence is absent. */
  normalized: number | null;
  weight: number;
  contribution: number;
  state: EvidenceState;
  reasonCode: string;
}

export interface OpportunityScore {
  /** 0..100, computed over AVAILABLE components only. */
  score: number;
  components: ScoredComponent[];
  policyVersion: string;
  coverage: EvidenceCoverage;
  confidence: Confidence;
  /** Weight share that had no evidence — the honest caveat on the number. */
  unscoredWeightShare: number;
  explanation: string;
}

export interface ScoreInput {
  components: Array<{ component: ScoreComponent; raw: unknown; normalized: number | null; state: EvidenceState; reasonCode: string }>;
  coverage: EvidenceCoverage;
  confidence: Confidence;
  weights?: ComponentWeights;
}

/**
 * Scores over the components that HAVE evidence, and reports how much weight
 * was unscored. Absent evidence therefore lowers confidence and completeness
 * without dragging the score to zero — the difference between "this is a poor
 * opportunity" and "we cannot see this opportunity yet".
 */
export function scoreOpportunity(input: ScoreInput): OpportunityScore {
  const w = input.weights ?? DEFAULT_WEIGHTS;
  const scored: ScoredComponent[] = [];
  let weightWithEvidence = 0;
  let weightedSum = 0;
  let totalWeight = 0;

  for (const c of input.components) {
    const weight = w.weights[c.component] ?? 0;
    totalWeight += weight;
    const hasEvidence = c.normalized !== null && (c.state === 'KNOWN' || c.state === 'PARTIAL');
    // PARTIAL evidence counts at reduced strength rather than being discarded.
    const strength = c.state === 'PARTIAL' ? 0.6 : 1;
    const contribution = hasEvidence ? (c.normalized as number) * weight * strength : 0;
    if (hasEvidence) {
      weightWithEvidence += weight * strength;
      weightedSum += contribution;
    }
    scored.push({
      component: c.component,
      raw: c.raw,
      normalized: c.normalized,
      weight,
      contribution: Number(contribution.toFixed(3)),
      state: c.state,
      reasonCode: c.reasonCode,
    });
  }

  const score = weightWithEvidence === 0 ? 0 : (weightedSum / weightWithEvidence) * 100;
  const unscoredWeightShare = totalWeight === 0 ? 1 : 1 - weightWithEvidence / totalWeight;

  const top = [...scored].filter((s) => s.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const explanation = weightWithEvidence === 0
    ? 'No component had usable evidence, so this opportunity is unscored rather than low-scoring.'
    : `Driven by ${top.map((t) => `${t.component} (${t.contribution.toFixed(1)})`).join(', ')}. ` +
      `${(unscoredWeightShare * 100).toFixed(0)}% of scoring weight had no evidence.`;

  return {
    score: Number(score.toFixed(2)),
    components: scored,
    policyVersion: w.version,
    coverage: input.coverage,
    confidence: input.confidence,
    unscoredWeightShare: Number(unscoredWeightShare.toFixed(3)),
    explanation,
  };
}

// ── Effort / risk / priority ────────────────────────────────────────────────

export const EFFORT_LEVELS = ['TRIVIAL', 'LOW', 'MEDIUM', 'HIGH', 'STRUCTURAL'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Risk = (typeof RISK_LEVELS)[number];

export const PRIORITY_BUCKETS = ['NOW', 'NEXT', 'WATCH', 'BLOCKED'] as const;
export type PriorityBucket = (typeof PRIORITY_BUCKETS)[number];

const EFFORT_PENALTY: Record<Effort, number> = { TRIVIAL: 0, LOW: 0.05, MEDIUM: 0.15, HIGH: 0.3, STRUCTURAL: 0.45 };
const RISK_PENALTY: Record<Risk, number> = { LOW: 0, MEDIUM: 0.1, HIGH: 0.3, CRITICAL: 0.6 };

export interface PriorityInput {
  score: number;
  confidence: Confidence;
  effort: Effort;
  risk: Risk;
  commercialReadiness: CommercialReadiness;
  seoReady: boolean;
  /** Unmet dependencies (e.g. a shared template fix). */
  blockedBy: string[];
}

export interface PriorityResult {
  bucket: PriorityBucket;
  adjustedScore: number;
  reasons: string[];
}

export function prioritise(i: PriorityInput): PriorityResult {
  const reasons: string[] = [];

  // BLOCKED is about eligibility, not attractiveness. A blocked opportunity
  // keeps its score so that fixing the blocker is visibly worth doing.
  if (i.blockedBy.length > 0) {
    reasons.push(`Blocked by: ${i.blockedBy.join(', ')}.`);
  }
  if (!i.seoReady) reasons.push('A hard SEO blocker makes this page ineligible until it is cleared.');
  if (['CATALOGUE_THIN', 'OUT_OF_STOCK', 'LIFECYCLE_BLOCKED'].includes(i.commercialReadiness)) {
    reasons.push(`Commercially ${i.commercialReadiness}: the demand is real but GoldPlus cannot serve it yet.`);
  }

  const penalty = EFFORT_PENALTY[i.effort] + RISK_PENALTY[i.risk];
  const confidenceFactor = i.confidence === 'HIGH' ? 1 : i.confidence === 'MEDIUM' ? 0.8 : 0.55;
  const adjustedScore = Number(Math.max(0, i.score * (1 - penalty) * confidenceFactor).toFixed(2));
  reasons.push(`Adjusted ${i.score} → ${adjustedScore} for ${i.effort} effort, ${i.risk} risk, ${i.confidence} confidence.`);

  const ineligible = !i.seoReady
    || i.blockedBy.length > 0
    || ['CATALOGUE_THIN', 'OUT_OF_STOCK', 'LIFECYCLE_BLOCKED'].includes(i.commercialReadiness);
  if (ineligible) return { bucket: 'BLOCKED', adjustedScore, reasons };

  if (i.risk === 'CRITICAL') {
    reasons.push('Critical risk is never scheduled as NOW, whatever the upside.');
    return { bucket: 'WATCH', adjustedScore, reasons };
  }
  if (adjustedScore >= 60 && i.confidence !== 'LOW') return { bucket: 'NOW', adjustedScore, reasons };
  if (adjustedScore >= 35) return { bucket: 'NEXT', adjustedScore, reasons };
  return { bucket: 'WATCH', adjustedScore, reasons };
}

// ── Recommendation gating ───────────────────────────────────────────────────

export const ACTION_CLASSES = [
  'REFRESH_EVIDENCE', 'CREATE_WORK_ITEM', 'REPRIORITISE_WORK', 'RESUBMIT_APPROVED_SITEMAP',
  'FIX_INTERNAL_LINK', 'REGENERATE_SCHEMA_FROM_TRUTH', 'REFRESH_METADATA_FROM_TRUTH',
  'IMPROVE_CONTENT', 'CREATE_CONTENT', 'EXPAND_CATALOGUE', 'CLEAR_TECHNICAL_BLOCKER',
  'CANONICAL_CHANGE', 'REDIRECT_CHANGE', 'INDEXABILITY_CHANGE',
] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

/**
 * Turns readiness into the RIGHT recommendation. This is where "business truth
 * outranks SEO optics" is enforced: high demand against a thin catalogue
 * recommends expanding the catalogue, never indexing an empty page.
 */
export function recommendedAction(i: {
  commercialReadiness: CommercialReadiness;
  seoBlocking: SeoBlocker[];
  contentThin: boolean;
  hasOwnerPage: boolean;
}): { actionClass: ActionClass; rationale: string } {
  if (i.seoBlocking.length > 0) {
    return {
      actionClass: 'CLEAR_TECHNICAL_BLOCKER',
      rationale: `The page cannot rank while ${i.seoBlocking.join(', ')} applies. Clear that before investing in content.`,
    };
  }
  if (['CATALOGUE_THIN', 'OUT_OF_STOCK', 'LOW_STOCK'].includes(i.commercialReadiness)) {
    return {
      actionClass: 'EXPAND_CATALOGUE',
      rationale: 'The demand is real but the catalogue cannot satisfy it. Indexing a thin page would earn a poor-quality impression, not a sale.',
    };
  }
  if (i.commercialReadiness === 'LIFECYCLE_BLOCKED') {
    return { actionClass: 'CREATE_WORK_ITEM', rationale: 'The lifecycle decision must be resolved before this page can own demand.' };
  }
  if (!i.hasOwnerPage) {
    return { actionClass: 'CREATE_CONTENT', rationale: 'No GoldPlus page currently owns this demand and the catalogue can support one.' };
  }
  if (i.contentThin) {
    return { actionClass: 'IMPROVE_CONTENT', rationale: 'An owning page exists but does not answer the intent well enough to earn the ranking.' };
  }
  return { actionClass: 'REPRIORITISE_WORK', rationale: 'The page is ready; the remaining lever is prioritisation and internal support.' };
}
