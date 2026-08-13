/**
 * AEO answer units — grounded answers to real buyer questions.
 *
 * This is NOT a content generator. An answer unit is a claim GoldPlus is
 * willing to stand behind, and it may only reach READY when every fact it
 * asserts is traceable to a verified source that already exists in the system:
 * seo_battery_compat (VERIFIED only), seo_storage_tests, the product
 * catalogue, business_info, the delivery contract.
 *
 * The rule that gives this value: NO FACT SOURCE = NO DEFINITIVE ANSWER.
 * A missing fact does not become a hedge or an approximation; it blocks
 * publication and names precisely what is needed to unblock it.
 */

export const ANSWER_READINESS = ['READY', 'PARTIAL', 'BLOCKED_BY_MISSING_FACT', 'DRAFT_ONLY'] as const;
export type AnswerReadiness = (typeof ANSWER_READINESS)[number];

export const ANSWER_TYPES = [
  'COMPATIBILITY', 'SPECIFICATION', 'POLICY', 'PROCESS', 'RECOMMENDATION', 'VERIFICATION', 'AVAILABILITY',
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

/** Sources that may ground a published claim. Anything else is not evidence. */
export const FACT_SOURCES = [
  'BATTERY_COMPAT_VERIFIED', 'STORAGE_TEST', 'PRODUCT_CATALOGUE', 'PRODUCT_SPEC',
  'BUSINESS_INFO', 'DELIVERY_CONTRACT', 'WARRANTY_POLICY', 'RETURNS_POLICY', 'VERIFICATION_SYSTEM',
] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

export interface VerifiedFact {
  key: string;
  value: string;
  source: FactSource;
  sourceId: string;
  /**
   * Some sources carry their own verification state. A PROVISIONAL battery
   * fit is real evidence but not a definitive claim.
   */
  verified: boolean;
}

export interface AnswerUnitDraft {
  question: string;
  intent: string;
  answerType: AnswerType;
  /** Fact keys this answer cannot be stated without. */
  requiredFactKeys: string[];
  availableFacts: VerifiedFact[];
  productEntities: string[];
  categoryEntities: string[];
}

export interface AnswerUnit {
  question: string;
  intent: string;
  answerType: AnswerType;
  verifiedFacts: VerifiedFact[];
  sourceIds: string[];
  productEntities: string[];
  categoryEntities: string[];
  missingFacts: string[];
  unverifiedFacts: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readiness: AnswerReadiness;
  /** Exactly what an operator must supply to move this to READY. */
  blockedReason: string | null;
}

/**
 * Assembles an answer unit and decides whether it may be published.
 *
 * READY requires every required fact present AND verified. A fact that exists
 * but is unverified (e.g. a PROVISIONAL battery fit) degrades the unit to
 * PARTIAL — it may inform, but it may not assert.
 */
export function buildAnswerUnit(draft: AnswerUnitDraft): AnswerUnit {
  const byKey = new Map(draft.availableFacts.map((f) => [f.key, f]));
  const missingFacts = draft.requiredFactKeys.filter((k) => !byKey.has(k));
  const present = draft.requiredFactKeys.map((k) => byKey.get(k)).filter((f): f is VerifiedFact => Boolean(f));
  const unverifiedFacts = present.filter((f) => !f.verified).map((f) => f.key);

  let readiness: AnswerReadiness;
  let blockedReason: string | null = null;

  if (missingFacts.length > 0) {
    readiness = 'BLOCKED_BY_MISSING_FACT';
    blockedReason =
      `Cannot answer definitively without: ${missingFacts.join(', ')}. ` +
      'Record these facts against a verified source and this unit unblocks automatically.';
  } else if (unverifiedFacts.length > 0) {
    readiness = 'PARTIAL';
    blockedReason =
      `These facts exist but are not verified: ${unverifiedFacts.join(', ')}. ` +
      'The answer may guide a customer but must not state them as confirmed.';
  } else if (present.length === 0) {
    // No required facts declared at all — a question nobody grounded.
    readiness = 'DRAFT_ONLY';
    blockedReason = 'No verified facts support this answer.';
  } else {
    readiness = 'READY';
  }

  const confidence: AnswerUnit['confidence'] =
    readiness === 'READY' ? 'HIGH' : readiness === 'PARTIAL' ? 'MEDIUM' : 'LOW';

  return {
    question: draft.question,
    intent: draft.intent,
    answerType: draft.answerType,
    verifiedFacts: present,
    sourceIds: [...new Set(present.map((f) => f.sourceId))],
    productEntities: draft.productEntities,
    categoryEntities: draft.categoryEntities,
    missingFacts,
    unverifiedFacts,
    confidence,
    readiness,
    blockedReason,
  };
}

/** Only a READY unit may make a definitive public claim. */
export const mayPublishDefinitiveAnswer = (u: AnswerUnit): boolean => u.readiness === 'READY';

// ── Candidate questions ─────────────────────────────────────────────────────

export interface AnswerUnitTemplate {
  id: string;
  question: string;
  intent: string;
  answerType: AnswerType;
  requiredFactKeys: string[];
  /** Which source must ground it — used to route fact collection. */
  groundingSource: FactSource;
}

/**
 * Real buyer questions GoldPlus is positioned to answer, each tied to a source
 * that exists in the system today. Deliberately narrow: a question with no
 * possible grounding does not belong here at all.
 */
export const ANSWER_UNIT_TEMPLATES: AnswerUnitTemplate[] = [
  {
    id: 'battery-fit',
    question: 'Which battery fits {device}?',
    intent: 'COMPATIBILITY',
    answerType: 'COMPATIBILITY',
    requiredFactKeys: ['device_model', 'battery_reference', 'fit_verified'],
    groundingSource: 'BATTERY_COMPAT_VERIFIED',
  },
  {
    id: 'storage-capacity-real',
    question: 'Is the {product} really {capacity}?',
    intent: 'PROBLEM_SOLUTION',
    answerType: 'VERIFICATION',
    requiredFactKeys: ['claimed_capacity', 'tested_capacity', 'test_result'],
    groundingSource: 'STORAGE_TEST',
  },
  {
    id: 'product-verification',
    question: 'How do I verify a GoldPlus product is genuine?',
    intent: 'PROBLEM_SOLUTION',
    answerType: 'PROCESS',
    requiredFactKeys: ['verification_method', 'verification_url'],
    groundingSource: 'VERIFICATION_SYSTEM',
  },
  {
    id: 'warranty-terms',
    question: 'What warranty applies to {product}?',
    intent: 'AFTERSALES',
    answerType: 'POLICY',
    requiredFactKeys: ['warranty_policy'],
    groundingSource: 'WARRANTY_POLICY',
  },
  {
    id: 'delivery-process',
    question: 'How does delivery work in Kampala?',
    intent: 'LOCAL',
    answerType: 'PROCESS',
    requiredFactKeys: ['delivery_areas', 'delivery_timing'],
    groundingSource: 'DELIVERY_CONTRACT',
  },
  {
    id: 'returns-process',
    question: 'How do I return a product?',
    intent: 'AFTERSALES',
    answerType: 'POLICY',
    requiredFactKeys: ['returns_policy'],
    groundingSource: 'RETURNS_POLICY',
  },
  {
    id: 'charger-compat',
    question: 'Which charger supports {device}?',
    intent: 'COMPATIBILITY',
    answerType: 'COMPATIBILITY',
    requiredFactKeys: ['device_model', 'charger_standard', 'wattage'],
    groundingSource: 'PRODUCT_SPEC',
  },
];

/**
 * Coverage report: which questions GoldPlus can answer today and, for the rest,
 * exactly which facts are missing. This is the AEO work queue — grounded in
 * what is absent, not in a wish list of content.
 */
export function answerUnitCoverage(units: AnswerUnit[]): {
  ready: number;
  partial: number;
  blocked: number;
  draftOnly: number;
  /** Fact keys blocking the most units — the highest-leverage things to record. */
  topMissingFacts: Array<{ factKey: string; blockedUnits: number }>;
} {
  const counts = { ready: 0, partial: 0, blocked: 0, draftOnly: 0 };
  const missing = new Map<string, number>();

  for (const u of units) {
    if (u.readiness === 'READY') counts.ready += 1;
    else if (u.readiness === 'PARTIAL') counts.partial += 1;
    else if (u.readiness === 'BLOCKED_BY_MISSING_FACT') counts.blocked += 1;
    else counts.draftOnly += 1;
    for (const f of u.missingFacts) missing.set(f, (missing.get(f) ?? 0) + 1);
  }

  return {
    ...counts,
    topMissingFacts: [...missing.entries()]
      .map(([factKey, blockedUnits]) => ({ factKey, blockedUnits }))
      .sort((a, b) => b.blockedUnits - a.blockedUnits || a.factKey.localeCompare(b.factKey)),
  };
}

// ── Content gap gating ──────────────────────────────────────────────────────

export interface ContentGapCandidate {
  queryCluster: string;
  intent: string;
  userNeed: string;
  currentCoverage: 'NONE' | 'PARTIAL' | 'ADEQUATE';
  recommendedPageType: string;
  preferredEntity: string | null;
  factRequirements: string[];
  cannibalisationRisk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  commercialValue: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface GapVerdict {
  isGenuineGap: boolean;
  reasons: string[];
}

/**
 * A content gap is only genuine when all six conditions hold. This is the
 * gate that stops the system becoming a page factory: distinct intent,
 * insufficient coverage, no cannibalisation harm, facts available, real value,
 * and a viable SEO path.
 */
export function assessContentGap(i: {
  distinctIntent: boolean;
  existingCoverage: 'NONE' | 'PARTIAL' | 'ADEQUATE';
  cannibalisationRisk: ContentGapCandidate['cannibalisationRisk'];
  factsAvailable: boolean;
  commercialOrUserValue: boolean;
  seoPathExists: boolean;
}): GapVerdict {
  const reasons: string[] = [];
  if (!i.distinctIntent) reasons.push('The intent is already served by an existing page; a new one would duplicate it.');
  if (i.existingCoverage === 'ADEQUATE') reasons.push('Existing coverage is already adequate.');
  if (i.cannibalisationRisk === 'HIGH') reasons.push('A new page here would compete with an existing page for the same demand.');
  if (!i.factsAvailable) reasons.push('The facts required to write this honestly do not exist yet.');
  if (!i.commercialOrUserValue) reasons.push('No demonstrable commercial or user value.');
  if (!i.seoPathExists) reasons.push('No viable path to indexability for this page.');
  return { isGenuineGap: reasons.length === 0, reasons: reasons.length === 0 ? ['All six gap conditions are satisfied.'] : reasons };
}
