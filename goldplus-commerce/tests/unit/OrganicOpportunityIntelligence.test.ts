import { describe, expect, it } from 'vitest';

import {
  known, unknown, assessEvidenceCoverage, assessConfidence,
  assessCommercialReadiness, assessSeoReadiness, scoreOpportunity, prioritise,
  recommendedAction, DEFAULT_WEIGHTS, SCORING_POLICY_VERSION, CATALOGUE_DEPTH_FLOOR,
  type ScoreComponent,
} from '../../apps/api/src/application/use-cases/seo-growth/OrganicOpportunityScoring';
import {
  normalizeQuery, clusterQueries, classifyIntent, resolveOwnership,
  preferredOwnerType, classifyCannibalisation, type ClusterEntity,
} from '../../apps/api/src/application/use-cases/seo-growth/QueryIntelligence';
import {
  consolidateRootCauses, assessDecay, evaluateActionRequest, advanceOutcome,
  catalogueEntry, ACTION_CATALOGUE, CONSOLIDATION_THRESHOLD,
} from '../../apps/api/src/application/use-cases/seo-growth/OpportunityPortfolio';
import {
  buildAnswerUnit, mayPublishDefinitiveAnswer, answerUnitCoverage, assessContentGap,
  ANSWER_UNIT_TEMPLATES,
} from '../../apps/api/src/application/use-cases/seo-growth/AnswerUnitEngine';

// ── Unknown is not zero ─────────────────────────────────────────────────────

describe('missing evidence lowers confidence, it does not fake a low score', () => {
  const comps = (over: Partial<Record<ScoreComponent, { n: number | null; s: 'KNOWN' | 'UNKNOWN' }>> = {}) =>
    ([
      ['SEARCH_DEMAND', over.SEARCH_DEMAND ?? { n: null, s: 'UNKNOWN' as const }],
      ['COMMERCIAL_INTENT', over.COMMERCIAL_INTENT ?? { n: 0.9, s: 'KNOWN' as const }],
      ['CATEGORY_PRIORITY', over.CATEGORY_PRIORITY ?? { n: 0.8, s: 'KNOWN' as const }],
    ] as Array<[ScoreComponent, { n: number | null; s: 'KNOWN' | 'UNKNOWN' }]>)
      .map(([component, v]) => ({ component, raw: v.n, normalized: v.n, state: v.s, reasonCode: 'test' }));

  it('scores over available components rather than treating UNKNOWN as 0', () => {
    const coverage = assessEvidenceCoverage({ COMMERCE: 'KNOWN', TECHNICAL: 'KNOWN' });
    const s = scoreOpportunity({ components: comps(), coverage, confidence: 'MEDIUM' });
    // Strong commercial evidence must still produce a strong score even with
    // no search-demand data at all.
    expect(s.score).toBeGreaterThan(70);
    expect(s.unscoredWeightShare).toBeGreaterThan(0);
    expect(s.explanation).toMatch(/no evidence/i);
  });

  it('reports zero only when nothing at all is known', () => {
    const coverage = assessEvidenceCoverage({});
    const s = scoreOpportunity({
      components: [{ component: 'SEARCH_DEMAND', raw: null, normalized: null, state: 'UNKNOWN', reasonCode: 'x' }],
      coverage, confidence: 'LOW',
    });
    expect(s.score).toBe(0);
    expect(s.explanation).toMatch(/unscored rather than low-scoring/i);
  });

  it('never reports HIGH confidence without search-demand evidence', () => {
    // Four of ten dimensions and no demand data is honestly LOW.
    const some = assessEvidenceCoverage({ COMMERCE: 'KNOWN', TECHNICAL: 'KNOWN', CONTENT: 'KNOWN', LINK_GRAPH: 'KNOWN' });
    expect(assessConfidence({ coverage: some, confirmingSignals: 3, persistent: true, stale: false })).toBe('LOW');
    // Broad non-demand coverage reaches MEDIUM — but never HIGH.
    const broad = assessEvidenceCoverage({
      COMMERCE: 'KNOWN', TECHNICAL: 'KNOWN', CONTENT: 'KNOWN', LINK_GRAPH: 'KNOWN',
      COMPETITOR: 'KNOWN', CWV: 'KNOWN',
    });
    expect(assessConfidence({ coverage: broad, confirmingSignals: 3, persistent: true, stale: false })).toBe('MEDIUM');
    const withDemand = assessEvidenceCoverage({ SEARCH_DEMAND: 'KNOWN', COMMERCE: 'KNOWN', TECHNICAL: 'KNOWN', CONTENT: 'KNOWN', LINK_GRAPH: 'KNOWN', COMPETITOR: 'KNOWN' });
    expect(assessConfidence({ coverage: withDemand, confirmingSignals: 3, persistent: true, stale: false })).toBe('HIGH');
  });

  it('computes completeness over applicable dimensions only', () => {
    const c = assessEvidenceCoverage({ SEARCH_DEMAND: 'KNOWN', COMMERCE: 'KNOWN', GA4: 'NOT_APPLICABLE', MERCHANT: 'NOT_APPLICABLE' });
    expect(c.notApplicable).toEqual(['GA4', 'MERCHANT']);
    expect(c.completeness).toBeCloseTo(2 / 8);
  });

  it('is deterministic and stamps the policy version', () => {
    const coverage = assessEvidenceCoverage({ COMMERCE: 'KNOWN' });
    const a = scoreOpportunity({ components: comps(), coverage, confidence: 'MEDIUM' });
    const b = scoreOpportunity({ components: comps(), coverage, confidence: 'MEDIUM' });
    expect(a.score).toBe(b.score);
    expect(a.policyVersion).toBe(SCORING_POLICY_VERSION);
    expect(DEFAULT_WEIGHTS.version).toBe(SCORING_POLICY_VERSION);
  });

  it('explains itself: every component carries weight, contribution and reason', () => {
    const s = scoreOpportunity({ components: comps(), coverage: assessEvidenceCoverage({ COMMERCE: 'KNOWN' }), confidence: 'MEDIUM' });
    for (const c of s.components) {
      expect(c).toHaveProperty('weight');
      expect(c).toHaveProperty('contribution');
      expect(c).toHaveProperty('reasonCode');
    }
    // The score must be reproducible from its own components.
    const scored = s.components.filter((c) => c.normalized !== null);
    const recomputed = scored.reduce((n, c) => n + c.contribution, 0) / scored.reduce((n, c) => n + c.weight, 0) * 100;
    expect(recomputed).toBeCloseTo(s.score, 1);
  });
});

// ── Readiness ───────────────────────────────────────────────────────────────

describe('business truth gates the recommendation', () => {
  it('calls a thin catalogue thin, whatever the demand', () => {
    const r = assessCommercialReadiness({
      eligibleProducts: known(2), inStockProducts: known(2),
      pricingComplete: known(true), lifecycleBlocked: known(false),
    });
    expect(r.readiness).toBe('CATALOGUE_THIN');
    expect(r.reasons[0]).toMatch(new RegExp(String(CATALOGUE_DEPTH_FLOOR)));
  });

  it('does not guess readiness when catalogue depth is unknown', () => {
    const r = assessCommercialReadiness({
      eligibleProducts: unknown(), inStockProducts: unknown(),
      pricingComplete: unknown(), lifecycleBlocked: unknown(),
    });
    expect(r.readiness).toBe('UNKNOWN');
  });

  it('caps at PARTIALLY_READY when stock is unknown', () => {
    const r = assessCommercialReadiness({
      eligibleProducts: known(10), inStockProducts: unknown(),
      pricingComplete: known(true), lifecycleBlocked: known(false),
    });
    expect(r.readiness).toBe('PARTIALLY_READY');
  });

  it('treats hard SEO blockers as disqualifying', () => {
    expect(assessSeoReadiness(['NOINDEX']).ready).toBe(false);
    expect(assessSeoReadiness(['UNDERLINKED', 'SCHEMA_INCOMPLETE'])).toMatchObject({ ready: true, degrading: ['UNDERLINKED', 'SCHEMA_INCOMPLETE'] });
  });

  it('recommends expanding the catalogue, not indexing a thin page', () => {
    const a = recommendedAction({ commercialReadiness: 'CATALOGUE_THIN', seoBlocking: [], contentThin: true, hasOwnerPage: true });
    expect(a.actionClass).toBe('EXPAND_CATALOGUE');
    expect(a.rationale).toMatch(/not a sale|poor-quality/i);
  });

  it('clears the technical blocker before investing in content', () => {
    const a = recommendedAction({ commercialReadiness: 'READY', seoBlocking: ['NOINDEX'], contentThin: true, hasOwnerPage: true });
    expect(a.actionClass).toBe('CLEAR_TECHNICAL_BLOCKER');
  });
});

// ── Priority ────────────────────────────────────────────────────────────────

describe('priority reflects value, effort, risk and eligibility', () => {
  const base = {
    score: 80, confidence: 'HIGH' as const, effort: 'LOW' as const, risk: 'LOW' as const,
    commercialReadiness: 'READY' as const, seoReady: true, blockedBy: [] as string[],
  };

  it('schedules a ready, high-value, low-risk opportunity NOW', () => {
    expect(prioritise(base).bucket).toBe('NOW');
  });

  it('blocks an opportunity behind a hard SEO blocker but keeps its score visible', () => {
    const p = prioritise({ ...base, seoReady: false });
    expect(p.bucket).toBe('BLOCKED');
    // The score survives so that clearing the blocker is visibly worth doing.
    expect(p.adjustedScore).toBeGreaterThan(0);
  });

  it('blocks a thin catalogue however attractive the demand', () => {
    expect(prioritise({ ...base, commercialReadiness: 'CATALOGUE_THIN' }).bucket).toBe('BLOCKED');
  });

  it('never schedules critical risk as NOW', () => {
    expect(prioritise({ ...base, risk: 'CRITICAL' }).bucket).toBe('WATCH');
  });

  it('demotes structural effort and low confidence', () => {
    expect(prioritise({ ...base, effort: 'STRUCTURAL' }).adjustedScore).toBeLessThan(prioritise(base).adjustedScore);
    expect(prioritise({ ...base, confidence: 'LOW' }).bucket).not.toBe('NOW');
  });

  it('lets a commercially ready opportunity outrank a bigger but blocked one', () => {
    const vanity = prioritise({ ...base, score: 95, commercialReadiness: 'CATALOGUE_THIN' });
    const commercial = prioritise({ ...base, score: 70 });
    expect(vanity.bucket).toBe('BLOCKED');
    expect(commercial.bucket).toBe('NOW');
  });
});

// ── Query intelligence ──────────────────────────────────────────────────────

describe('query normalization is deterministic and non-destructive', () => {
  it('collapses brand, unit and synonym variants', () => {
    expect(normalizeQuery('Shop Gold Plus  POWERBANK 20000 mAh!').normalized).toBe('goldplus power bank 20000mah');
    expect(normalizeQuery('128 GB flash disk').normalized).toBe('128gb flash drive');
    expect(normalizeQuery('Type-C charger cable').normalized).toBe('usb c charging cable');
  });

  it('never destroys the original provider evidence', () => {
    const n = normalizeQuery('  Samsung   S21+ BATTERY ');
    expect(n.raw).toBe('  Samsung   S21+ BATTERY ');
    expect(n.normalized).toBe('samsung s21+ battery');
  });

  it('is idempotent', () => {
    const once = normalizeQuery('POWERBANK 10000 MAH').normalized;
    expect(normalizeQuery(once).normalized).toBe(once);
  });
});

describe('cluster identity is stable across runs', () => {
  const entities: ClusterEntity[] = [
    { entityId: 'cat-power', entityType: 'CATEGORY', terms: ['power bank'] },
    { entityId: 'compat-s21', entityType: 'COMPATIBILITY', terms: ['samsung s21 battery', 's21 battery'] },
  ];
  const queries = [
    { raw: 'power bank uganda' }, { raw: 'best power bank' },
    { raw: 'samsung s21 battery' }, { raw: 'earbuds price' },
  ];

  it('produces identical cluster keys on repeat runs', () => {
    const a = clusterQueries(queries, entities).map((c) => c.clusterKey);
    const b = clusterQueries([...queries].reverse(), entities).map((c) => c.clusterKey);
    expect(new Set(a)).toEqual(new Set(b));
  });

  it('binds a cluster to its entity where one matches', () => {
    const clusters = clusterQueries(queries, entities);
    const power = clusters.find((c) => c.entityId === 'cat-power')!;
    expect(power.method).toBe('ENTITY_MATCH');
    expect(power.members).toHaveLength(2);
    expect(power.confidence).toBeGreaterThan(0.8);
  });

  it('prefers the most specific entity', () => {
    const clusters = clusterQueries([{ raw: 'samsung s21 battery replacement' }], entities);
    expect(clusters[0].entityId).toBe('compat-s21');
  });

  it('falls back to a signature cluster with lower confidence', () => {
    const clusters = clusterQueries([{ raw: 'earbuds price' }], entities);
    expect(clusters[0].method).toBe('RULE');
    expect(clusters[0].confidence).toBeLessThan(0.8);
  });
});

describe('intent classification prefers the searcher’s actual need', () => {
  it('reads compatibility ahead of the bare entity type', () => {
    const r = classifyIntent({ raw: 'which battery fits my samsung s21', entityType: 'PRODUCT' });
    expect(r.primary).toBe('COMPATIBILITY');
    expect(r.secondary).toBe('PRODUCT');
    expect(r.method).toBe('HYBRID');
  });

  it('detects price, comparison, aftersales and problem intents', () => {
    expect(classifyIntent({ raw: 'how much is a power bank' }).primary).toBe('PRICE');
    expect(classifyIntent({ raw: 'anker vs oraimo power bank' }).primary).toBe('COMPARISON');
    expect(classifyIntent({ raw: 'warranty on my charger' }).primary).toBe('AFTERSALES');
    expect(classifyIntent({ raw: 'how to verify goldplus product' }).primary).toBe('PROBLEM_SOLUTION');
  });

  it('recognises brand queries', () => {
    expect(classifyIntent({ raw: 'shopgoldplus' }).matched).toContain('BRAND:goldplus');
  });

  it('admits when it cannot tell', () => {
    const r = classifyIntent({ raw: 'zxqv' });
    expect(r.primary).toBe('UNKNOWN');
    expect(r.confidence).toBeLessThan(0.3);
  });
});

describe('page ownership does not assume "no page" means "make a page"', () => {
  it('refuses to recommend a page the catalogue cannot support', () => {
    const r = resolveOwnership({
      intent: 'CATEGORY', currentOwnerUrl: null, currentOwnerType: null, candidateUrl: null,
      contentThin: false, hasCommercialDepth: false, demandKnown: true,
    });
    expect(r.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.rationale).toMatch(/thin/i);
  });

  it('recommends a page when the catalogue can support one', () => {
    const r = resolveOwnership({
      intent: 'CATEGORY', currentOwnerUrl: null, currentOwnerType: null, candidateUrl: null,
      contentThin: false, hasCommercialDepth: true, demandKnown: true,
    });
    expect(r.decision).toBe('CREATE_PAGE_CANDIDATE');
  });

  it('flags the wrong page type owning an intent', () => {
    const r = resolveOwnership({
      intent: 'COMPATIBILITY', currentOwnerUrl: '/products/x', currentOwnerType: 'PRODUCT',
      // Ownership must now declare its evidence: a page only "currently owns"
      // demand when something actually observed it doing so.
      currentOwnerEvidence: 'PROVIDER_OBSERVED',
      candidateUrl: '/battery-finder', contentThin: false, hasCommercialDepth: true, demandKnown: true,
    });
    expect(r.decision).toBe('CONTENT_DIFFERENTIATION');
    expect(r.preferredOwnerUrl).toBe('/battery-finder');
  });

  it('says brand demand needs no page', () => {
    expect(preferredOwnerType('BRAND')).toBe('NO_PAGE_REQUIRED');
  });

  it('will not confirm an owner without performance evidence', () => {
    const r = resolveOwnership({
      intent: 'CATEGORY', currentOwnerUrl: '/power', currentOwnerType: 'CATEGORY', candidateUrl: null,
      contentThin: false, hasCommercialDepth: true, demandKnown: false,
    });
    expect(r.decision).toBe('INSUFFICIENT_EVIDENCE');
  });
});

// ── Cannibalisation ─────────────────────────────────────────────────────────

describe('cannibalisation is not "two URLs appeared"', () => {
  const url = (over: Partial<Parameters<typeof classifyCannibalisation>[0]['urls'][number]> = {}) => ({
    url: '/a', impressions: 500, clicks: 20, intent: 'CATEGORY' as const, ownerType: 'CATEGORY' as const,
    canonicalTarget: null, contentSimilarity: 0.2, lifecycleActive: true, ...over,
  });

  it('calls different intents healthy coverage, not conflict', () => {
    const r = classifyCannibalisation({
      urls: [url(), url({ url: '/b', intent: 'INFORMATIONAL' })], persistence: 5,
    });
    expect(r.classification).toBe('INTENT_SPLIT');
  });

  it('flags a canonical conflict as a defect regardless of traffic', () => {
    const r = classifyCannibalisation({
      urls: [url({ canonicalTarget: '/a' }), url({ url: '/b', canonicalTarget: '/c' })], persistence: 0,
    });
    expect(r.classification).toBe('CANONICAL_CONFLICT');
  });

  it('refuses to assert conflict without performance evidence', () => {
    const r = classifyCannibalisation({
      urls: [url({ impressions: null }), url({ url: '/b', impressions: null })], persistence: 5,
    });
    expect(r.classification).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('waits for persistence before calling it more than variance', () => {
    const r = classifyCannibalisation({ urls: [url(), url({ url: '/b' })], persistence: 1 });
    expect(r.classification).toBe('TEMPORARY_RANKING_VARIANCE');
  });

  it('identifies true cannibalisation only when both pages matter and it persists', () => {
    const r = classifyCannibalisation({ urls: [url(), url({ url: '/b' })], persistence: 3 });
    expect(r.classification).toBe('TRUE_CANNIBALISATION');
    expect(r.affectedUrls).toHaveLength(2);
  });

  it('treats a retired page competing with a live one as a lifecycle problem', () => {
    const r = classifyCannibalisation({
      urls: [url(), url({ url: '/old', lifecycleActive: false })], persistence: 5,
    });
    expect(r.classification).toBe('LIFECYCLE_CONFLICT');
  });

  it('ignores an incidental second URL', () => {
    const r = classifyCannibalisation({ urls: [url(), url({ url: '/b', impressions: 5 })], persistence: 5 });
    expect(r.classification).toBe('BENIGN_MULTI_URL');
  });
});

// ── Portfolio ───────────────────────────────────────────────────────────────

describe('one root cause is one job, not twenty tickets', () => {
  const symptom = (i: number, family: string | null) => ({
    opportunityId: `o${i}`, entity: `/p/${i}`, templateFamily: family,
    actionClass: 'REGENERATE_SCHEMA_FROM_TRUTH' as const, reasonCodes: ['SCHEMA_INCOMPLETE'], score: 20,
  });

  it('consolidates symptoms sharing a template and action', () => {
    const r = consolidateRootCauses([symptom(1, 'product'), symptom(2, 'product'), symptom(3, 'product'), symptom(4, 'product')]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].memberCount).toBe(4);
    expect(r.groups[0].rootCauseKind).toBe('SCHEMA_TEMPLATE');
    expect(r.groups[0].unlockedScore).toBe(80);
    expect(r.independent).toHaveLength(0);
  });

  it('leaves genuinely separate symptoms independent', () => {
    const r = consolidateRootCauses([symptom(1, 'product'), symptom(2, 'product')]);
    expect(r.groups).toHaveLength(0);
    expect(r.independent).toHaveLength(2);
    expect(CONSOLIDATION_THRESHOLD).toBe(3);
  });

  it('never consolidates symptoms with no template family', () => {
    const r = consolidateRootCauses([symptom(1, null), symptom(2, null), symptom(3, null), symptom(4, null)]);
    expect(r.groups).toHaveLength(0);
    expect(r.independent).toHaveLength(4);
  });
});

describe('opportunities decay instead of accumulating for ever', () => {
  const base = {
    observationsSinceEvidence: 0, demandDisappeared: false, productPermanentlyUnavailable: false,
    issueResolved: false, supersededByOpportunityId: null, preferredPageChanged: false,
    commercialPriorityDropped: false,
  };

  it('keeps a live opportunity', () => expect(assessDecay(base).outcome).toBe('KEEP'));
  it('closes a resolved one', () => expect(assessDecay({ ...base, issueResolved: true }).outcome).toBe('CLOSE_RESOLVED'));
  it('closes one whose product is gone', () => expect(assessDecay({ ...base, productPermanentlyUnavailable: true }).outcome).toBe('CLOSE_OBSOLETE'));
  it('closes one superseded by another', () => expect(assessDecay({ ...base, supersededByOpportunityId: 'o9' }).outcome).toBe('CLOSE_SUPERSEDED'));
  it('downgrades on stale evidence', () => expect(assessDecay({ ...base, observationsSinceEvidence: 9 }).outcome).toBe('DOWNGRADE'));
});

// ── Executor contract ───────────────────────────────────────────────────────

describe('nothing reaches production without a complete, reversible request', () => {
  const good = {
    actionClass: 'FIX_INTERNAL_LINK' as const, entityId: 'e1', opportunityId: 'o1',
    evidenceIds: ['ev1'], policyVersion: '1.0.0', preconditions: [], confidence: 'HIGH' as const,
    idempotencyKey: 'k1', blastRadius: 3, expectedEffect: 'link added', rollbackClass: 'AUTOMATIC' as const,
    verificationPlan: 'recrawl',
  };
  const ctx = {
    earnedLevel: 3 as const,
    satisfiedPreconditions: ['TARGET_INDEXABLE', 'TARGET_NOT_REDIRECT', 'SOURCE_RELEVANT'],
    writesEnabled: true, observeOnly: false,
  };

  it('accepts a complete request from a class that earned it', () => {
    expect(evaluateActionRequest({ request: good, ...ctx }).outcome).toBe('ACCEPTED');
  });

  it('denies an incomplete request rather than defaulting the gaps', () => {
    const d = evaluateActionRequest({ request: { ...good, evidenceIds: [], idempotencyKey: undefined }, ...ctx });
    expect(d.outcome).toBe('DENIED');
    expect(d.outcome === 'DENIED' && d.code).toBe('INCOMPLETE_REQUEST');
    expect(d.outcome === 'DENIED' && d.reason).toMatch(/evidenceIds|idempotencyKey/);
  });

  it('defers when preconditions are unmet', () => {
    const d = evaluateActionRequest({ request: good, ...ctx, satisfiedPreconditions: [] });
    expect(d.outcome).toBe('DEFERRED');
    expect(d.outcome === 'DEFERRED' && d.code).toBe('PRECONDITIONS_UNMET');
  });

  it('refuses an irreversible action outright', () => {
    const d = evaluateActionRequest({ request: { ...good, rollbackClass: 'IRREVERSIBLE' }, ...ctx });
    expect(d.outcome === 'DENIED' && d.code).toBe('IRREVERSIBLE');
  });

  it('requires a rollback plan where the catalogue demands one', () => {
    const d = evaluateActionRequest({ request: { ...good, rollbackClass: 'NONE_REQUIRED' }, ...ctx });
    expect(d.outcome === 'DENIED' && d.code).toBe('ROLLBACK_REQUIRED');
  });

  it('never executes a structural class autonomously, at any level', () => {
    for (const cls of ['CANONICAL_CHANGE', 'REDIRECT_CHANGE', 'INDEXABILITY_CHANGE', 'EXPAND_CATALOGUE'] as const) {
      const d = evaluateActionRequest({
        request: { ...good, actionClass: cls, rollbackClass: 'MANUAL' },
        ...ctx, earnedLevel: 4, satisfiedPreconditions: ['HUMAN_APPROVAL', 'EVIDENCE_PERSISTENT', 'SUCCESSOR_EXISTS', 'GATES_SATISFIED', 'COMMERCIAL_DECISION'],
      });
      expect(d.outcome, cls).toBe('DENIED');
      expect(d.outcome === 'DENIED' && d.code).toBe('REQUIRES_HUMAN');
    }
  });

  it('honours observe-only and the write switch', () => {
    expect(evaluateActionRequest({ request: good, ...ctx, observeOnly: true }))
      .toMatchObject({ outcome: 'DENIED', code: 'OBSERVE_ONLY' });
    expect(evaluateActionRequest({ request: good, ...ctx, writesEnabled: false }))
      .toMatchObject({ outcome: 'DENIED', code: 'WRITES_DISABLED' });
  });

  it('refuses a blast radius far beyond the class default', () => {
    const d = evaluateActionRequest({ request: { ...good, blastRadius: 999 }, ...ctx });
    expect(d.outcome === 'DENIED' && d.code).toBe('BLAST_RADIUS_EXCEEDED');
  });

  it('defers on low-confidence evidence', () => {
    const d = evaluateActionRequest({ request: { ...good, confidence: 'LOW' }, ...ctx });
    expect(d.outcome === 'DEFERRED' && d.code).toBe('LOW_CONFIDENCE');
  });

  it('caps destructive classes below autonomous in the catalogue itself', () => {
    for (const cls of ['CANONICAL_CHANGE', 'REDIRECT_CHANGE', 'INDEXABILITY_CHANGE'] as const) {
      expect(catalogueEntry(cls)!.autonomyMaxLevel).toBe(0);
    }
    expect(ACTION_CATALOGUE.every((e) => e.autonomyMaxLevel <= 4)).toBe(true);
  });
});

describe('deploying is not succeeding', () => {
  const base = { current: 'ACTION_PENDING' as const, actionExecuted: true, technicallyVerified: false, searchEvidenceAvailable: false, searchEffect: null, rolledBack: false };

  it('stops at VERIFICATION_PENDING until the change is technically verified', () => {
    expect(advanceOutcome(base)).toBe('VERIFICATION_PENDING');
  });

  it('stops at SEARCH_EFFECT_PENDING until search evidence exists', () => {
    expect(advanceOutcome({ ...base, technicallyVerified: true })).toBe('SEARCH_EFFECT_PENDING');
  });

  it('only claims a win when search evidence shows one', () => {
    expect(advanceOutcome({ ...base, technicallyVerified: true, searchEvidenceAvailable: true, searchEffect: 'IMPROVED' })).toBe('POSITIVE_OUTCOME');
    expect(advanceOutcome({ ...base, technicallyVerified: true, searchEvidenceAvailable: true, searchEffect: 'WORSE' })).toBe('NEGATIVE_OUTCOME');
  });

  it('reports a rollback above everything else', () => {
    expect(advanceOutcome({ ...base, rolledBack: true })).toBe('ROLLED_BACK');
  });
});

// ── Answer units ────────────────────────────────────────────────────────────

describe('no verified fact means no definitive answer', () => {
  const fact = (key: string, verified = true) => ({
    key, value: 'v', source: 'BATTERY_COMPAT_VERIFIED' as const, sourceId: `src-${key}`, verified,
  });

  it('blocks publication when a required fact is missing, and names it', () => {
    const u = buildAnswerUnit({
      question: 'Which battery fits Galaxy S21?', intent: 'COMPATIBILITY', answerType: 'COMPATIBILITY',
      requiredFactKeys: ['device_model', 'battery_reference', 'fit_verified'],
      availableFacts: [fact('device_model'), fact('battery_reference')],
      productEntities: [], categoryEntities: [],
    });
    expect(u.readiness).toBe('BLOCKED_BY_MISSING_FACT');
    expect(u.missingFacts).toEqual(['fit_verified']);
    expect(mayPublishDefinitiveAnswer(u)).toBe(false);
    expect(u.blockedReason).toMatch(/fit_verified/);
  });

  it('degrades to PARTIAL when a fact exists but is unverified', () => {
    const u = buildAnswerUnit({
      question: 'q', intent: 'COMPATIBILITY', answerType: 'COMPATIBILITY',
      requiredFactKeys: ['fit_verified'], availableFacts: [fact('fit_verified', false)],
      productEntities: [], categoryEntities: [],
    });
    expect(u.readiness).toBe('PARTIAL');
    expect(mayPublishDefinitiveAnswer(u)).toBe(false);
    expect(u.blockedReason).toMatch(/must not state them as confirmed/i);
  });

  it('publishes only when every required fact is present and verified', () => {
    const u = buildAnswerUnit({
      question: 'q', intent: 'COMPATIBILITY', answerType: 'COMPATIBILITY',
      requiredFactKeys: ['device_model', 'fit_verified'],
      availableFacts: [fact('device_model'), fact('fit_verified')],
      productEntities: ['p1'], categoryEntities: [],
    });
    expect(u.readiness).toBe('READY');
    expect(u.confidence).toBe('HIGH');
    expect(u.sourceIds).toHaveLength(2);
    expect(mayPublishDefinitiveAnswer(u)).toBe(true);
  });

  it('reports which missing facts block the most answers', () => {
    const mk = (missing: string[]) => buildAnswerUnit({
      question: 'q', intent: 'i', answerType: 'POLICY',
      requiredFactKeys: [...missing, 'present'], availableFacts: [fact('present')],
      productEntities: [], categoryEntities: [],
    });
    const cov = answerUnitCoverage([mk(['warranty_policy']), mk(['warranty_policy']), mk(['delivery_areas'])]);
    expect(cov.blocked).toBe(3);
    expect(cov.topMissingFacts[0]).toEqual({ factKey: 'warranty_policy', blockedUnits: 2 });
  });

  it('every shipped template is tied to a real grounding source', () => {
    for (const t of ANSWER_UNIT_TEMPLATES) {
      expect(t.requiredFactKeys.length).toBeGreaterThan(0);
      expect(t.groundingSource).toBeTruthy();
    }
  });
});

describe('a content gap must pass every condition', () => {
  const all = {
    distinctIntent: true, existingCoverage: 'NONE' as const, cannibalisationRisk: 'LOW' as const,
    factsAvailable: true, commercialOrUserValue: true, seoPathExists: true,
  };

  it('accepts a genuine gap', () => expect(assessContentGap(all).isGenuineGap).toBe(true));

  it.each([
    ['duplicate intent', { distinctIntent: false }],
    ['already covered', { existingCoverage: 'ADEQUATE' as const }],
    ['would cannibalise', { cannibalisationRisk: 'HIGH' as const }],
    ['no facts', { factsAvailable: false }],
    ['no value', { commercialOrUserValue: false }],
    ['no SEO path', { seoPathExists: false }],
  ])('rejects when %s', (_l, over) => {
    const v = assessContentGap({ ...all, ...over });
    expect(v.isGenuineGap).toBe(false);
    expect(v.reasons.length).toBeGreaterThan(0);
  });
});
