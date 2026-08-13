import { describe, expect, it } from 'vitest';

import {
  opportunityKey, answerKey, rootCauseKey, sourceHash, semanticHash,
  evaluationHash, factHash, classifyChange, invalidationTargets,
  SCORE_MATERIALITY, ENGINE_VERSION,
  type StoredSnapshot,
} from '../../apps/api/src/application/use-cases/seo-growth/OrganicIntelligenceIdentity';
import {
  OrganicIntelligenceMaterialiser,
  type MaterialiserPorts, type EntityCandidate, type MaterialisedOpportunity,
} from '../../apps/api/src/application/use-cases/seo-growth/OrganicIntelligenceMaterialiser';
import { known, unknown } from '../../apps/api/src/application/use-cases/seo-growth/OrganicOpportunityScoring';

// ── Identity ────────────────────────────────────────────────────────────────

describe('semantic identity survives everything that should not change it', () => {
  const key = () => opportunityKey({ opportunityClass: 'EXPAND_CATALOGUE', entityType: 'CATEGORY', entityId: '/storage' });

  it('is deterministic across calls', () => {
    expect(key()).toBe(key());
  });

  it('never encodes score, rank, run or time', () => {
    expect(key()).toBe('opp:expand-catalogue:category:/storage');
    expect(key()).not.toMatch(/\d{4}-\d{2}-\d{2}|run|rank|\d{10}/);
  });

  it('separates different findings on the same entity', () => {
    const a = opportunityKey({ opportunityClass: 'EXPAND_CATALOGUE', entityType: 'CATEGORY', entityId: '/storage' });
    const b = opportunityKey({ opportunityClass: 'CLEAR_TECHNICAL_BLOCKER', entityType: 'CATEGORY', entityId: '/storage' });
    expect(a).not.toBe(b);
  });

  it('identifies an answer unit by semantics, not by wording', () => {
    const a = answerKey({ templateId: 'battery-fit', entityContext: 'galaxy-s21', answerType: 'COMPATIBILITY' });
    const b = answerKey({ templateId: 'battery-fit', entityContext: 'galaxy-s21', answerType: 'COMPATIBILITY' });
    expect(a).toBe(b);
    // Rephrasing the question must not mint a second unit — the key has no
    // wording in it at all.
    expect(a).not.toMatch(/which|fits|\?/i);
  });

  it('derives a root cause from template family plus intervention', () => {
    expect(rootCauseKey({ templateFamily: 'product', actionClass: 'REGENERATE_SCHEMA_FROM_TRUTH' }))
      .toBe('rc:product:regenerate-schema-from-truth');
  });
});

describe('hashes separate reality from judgement', () => {
  it('is insensitive to key order and array order in evidence', () => {
    const a = sourceHash({ b: 2, a: 1, list: ['x', 'y'] });
    const b = sourceHash({ a: 1, list: ['y', 'x'], b: 2 });
    expect(a).toBe(b);
  });

  it('moves the source hash only when evidence moves', () => {
    expect(sourceHash({ stock: 5 })).not.toBe(sourceHash({ stock: 4 }));
  });

  it('moves the evaluation hash on a policy change while source stays put', () => {
    const src = sourceHash({ stock: 5 });
    const e1 = evaluationHash({ policyVersion: '1.0.0', engineVersion: ENGINE_VERSION, score: 70, components: [] });
    const e2 = evaluationHash({ policyVersion: '1.1.0', engineVersion: ENGINE_VERSION, score: 82, components: [] });
    expect(e1).not.toBe(e2);
    expect(sourceHash({ stock: 5 })).toBe(src);
  });

  it('moves the fact hash when a fact loses verification', () => {
    const verified = factHash([{ key: 'fit', sourceId: 's1', verified: true }]);
    const withdrawn = factHash([{ key: 'fit', sourceId: 's1', verified: false }]);
    expect(verified).not.toBe(withdrawn);
  });
});

// ── Change classification ───────────────────────────────────────────────────

const snap = (over: Partial<StoredSnapshot> = {}): StoredSnapshot => ({
  sourceHash: 's1', semanticHash: 'm1', evaluationHash: 'e1', policyVersion: '1.0.0',
  evidenceAvailable: ['COMMERCE', 'TECHNICAL'], score: 70, priorityBucket: 'NEXT', ...over,
});

describe('an unchanged run writes nothing', () => {
  it('classifies identical state as UNCHANGED with no write and no history', () => {
    const v = classifyChange(snap(), snap());
    expect(v.kind).toBe('UNCHANGED');
    expect(v.writeRequired).toBe(false);
    expect(v.historyRequired).toBe(false);
  });

  it('treats a first observation as CREATED', () => {
    expect(classifyChange(null, snap())).toMatchObject({ kind: 'CREATED', writeRequired: true, historyRequired: true });
  });
});

describe('policy change is not a demand change', () => {
  it('records POLICY_REEVALUATED when only the policy moved', () => {
    const v = classifyChange(snap(), snap({ policyVersion: '1.1.0', evaluationHash: 'e2', score: 82 }));
    expect(v.kind).toBe('POLICY_REEVALUATED');
    expect(v.reason).toMatch(/underlying evidence unchanged/i);
  });
});

describe('evidence gain and loss are distinct events', () => {
  it('reports EVIDENCE_ENRICHED when a new dimension appears', () => {
    const v = classifyChange(snap(), snap({ evidenceAvailable: ['COMMERCE', 'TECHNICAL', 'SEARCH_DEMAND'] }));
    expect(v.kind).toBe('EVIDENCE_ENRICHED');
    expect(v.reason).toMatch(/SEARCH_DEMAND/);
  });

  it('reports EVIDENCE_INVALIDATED when a dimension disappears', () => {
    const v = classifyChange(snap(), snap({ evidenceAvailable: ['COMMERCE'] }));
    expect(v.kind).toBe('EVIDENCE_INVALIDATED');
    expect(v.historyRequired).toBe(true);
  });

  it('prefers loss over gain when both occur', () => {
    const v = classifyChange(snap(), snap({ evidenceAvailable: ['COMMERCE', 'SEARCH_DEMAND'] }));
    expect(v.kind).toBe('EVIDENCE_INVALIDATED');
  });
});

describe('score noise does not become history', () => {
  it('refreshes freshness but writes no history for an immaterial drift', () => {
    const v = classifyChange(snap({ score: 78.20 }), snap({ sourceHash: 's2', score: 78.21 }));
    expect(v.kind).toBe('SOURCE_CHANGED');
    expect(v.writeRequired).toBe(true);
    expect(v.historyRequired).toBe(false);
  });

  it('records history once the move clears the materiality bar', () => {
    const v = classifyChange(snap({ score: 70 }), snap({ sourceHash: 's2', score: 70 + SCORE_MATERIALITY }));
    expect(v.historyRequired).toBe(true);
  });

  it('always records a priority transition, however small the score move', () => {
    const v = classifyChange(snap({ score: 60, priorityBucket: 'NEXT' }), snap({ sourceHash: 's2', score: 60.1, priorityBucket: 'NOW' }));
    expect(v.historyRequired).toBe(true);
    expect(v.reason).toMatch(/priority NEXT → NOW/);
  });
});

describe('withdrawn facts invalidate what depended on them', () => {
  it('finds only the dependents of the changed fact', () => {
    const edges = [
      { dependentKey: 'ans:battery-fit:s21', dependentKind: 'ANSWER_UNIT' as const, dependsOn: 'fact:compat:s21' },
      { dependentKey: 'ans:battery-fit:a52', dependentKind: 'ANSWER_UNIT' as const, dependsOn: 'fact:compat:a52' },
      { dependentKey: 'opp:x', dependentKind: 'OPPORTUNITY' as const, dependsOn: 'fact:compat:s21' },
    ];
    const t = invalidationTargets(edges, ['fact:compat:s21']);
    expect(t.answerUnits).toEqual(['ans:battery-fit:s21']);
    expect(t.opportunities).toEqual(['opp:x']);
  });

  it('returns nothing when no dependency changed', () => {
    expect(invalidationTargets([{ dependentKey: 'a', dependentKind: 'ANSWER_UNIT', dependsOn: 'f1' }], ['f2']))
      .toEqual({ opportunities: [], answerUnits: [] });
  });
});

// ── Pipeline ────────────────────────────────────────────────────────────────

const candidate = (over: Partial<EntityCandidate> = {}): EntityCandidate => ({
  entityType: 'CATEGORY',
  entityId: '/storage',
  entityLabel: 'Storage',
  templateFamily: 'category',
  commercial: {
    eligibleProducts: known(8), inStockProducts: known(6),
    pricingComplete: known(true), lifecycleBlocked: known(false),
  },
  seoBlockers: [],
  contentThin: false,
  hasOwnerPage: true,
  components: [
    { component: 'COMMERCIAL_INTENT', raw: 0.9, normalized: 0.9, state: 'KNOWN', reasonCode: 'category_commercial' },
    { component: 'CATEGORY_PRIORITY', raw: 0.8, normalized: 0.8, state: 'KNOWN', reasonCode: 'priority' },
    { component: 'SEARCH_DEMAND', raw: null, normalized: null, state: 'UNKNOWN', reasonCode: 'gsc_absent' },
  ],
  evidenceStates: { COMMERCE: 'KNOWN', TECHNICAL: 'KNOWN', CONTENT: 'KNOWN', LINK_GRAPH: 'KNOWN', COMPETITOR: 'KNOWN', CWV: 'KNOWN' },
  effort: 'LOW',
  risk: 'LOW',
  confirmingSignals: 2,
  persistent: true,
  staleEvidence: false,
  ...over,
});

function harness(over: {
  candidates?: EntityCandidate[]; snapshots?: Map<string, StoredSnapshot>; leaseHeld?: boolean;
  queryUniverse?: { queries: Array<{ raw: string; source: string; observedAt: string | null; isBackfill: boolean }>; entities: any[] };
  clusterHashes?: Map<string, string>;
  membershipKeys?: Set<string>;
  competingUrls?: Map<string, any[]>;
} = {}) {
  const rec = {
    upserts: [] as Array<{ key: string; isNew: boolean }>,
    components: [] as string[],
    history: [] as Array<{ key: string; event: string }>,
    touched: [] as string[],
    rootCauses: [] as string[],
    clusters: [] as Array<Record<string, unknown>>,
    membership: [] as string[],
    cannibalisation: [] as string[],
    content: [] as Array<{ key: string; classification: string }>,
    actionRequests: [] as Array<{ key: string; state: string; reason: string }>,
    workItems: [] as Array<{ key: string; material: boolean }>,
    links: [] as string[],
    finished: [] as Array<Record<string, unknown>>,
  };
  const ports: MaterialiserPorts = {
    startRun: async () => (over.leaseHeld ? null : { runId: 'run-1' }),
    finishRun: async (f) => { rec.finished.push(f as unknown as Record<string, unknown>); },
    loadCandidates: async () => over.candidates ?? [candidate()],
    loadSnapshots: async () => over.snapshots ?? new Map(),
    upsertOpportunity: async (i) => { rec.upserts.push({ key: i.opportunity.opportunityKey, isNew: i.isNew }); },
    writeComponents: async (i) => { rec.components.push(i.opportunityKey); },
    writeHistory: async (i) => { rec.history.push({ key: i.opportunityKey, event: i.eventType }); },
    touchSeen: async (i) => { rec.touched.push(i.opportunityKey); },
    upsertRootCause: async (i) => { rec.rootCauses.push(i.rootCauseKey); },
    reconcileWorkItem: async (i) => {
      rec.workItems.push({ key: i.opportunityKey, material: i.material });
      return { workItemId: i.material ? 'wi-1' : null, created: i.material, updated: false };
    },
    linkWorkItem: async (i) => { rec.links.push(i.opportunityKey); },
    upsertAnswerUnit: async () => ({ changed: true }),
    loadAnswerUnitHashes: async () => new Map(),

    loadQueryUniverse: async () => over.queryUniverse ?? { queries: [], entities: [] },
    upsertCluster: async (i) => { rec.clusters.push(i as unknown as Record<string, unknown>); return { changed: true }; },
    loadClusterHashes: async () => over.clusterHashes ?? new Map(),
    upsertQueryMembership: async (i) => { rec.membership.push(i.membershipKey); return { changed: true }; },
    loadMembershipKeys: async () => over.membershipKeys ?? new Set<string>(),
    loadCompetingUrls: async () => over.competingUrls ?? new Map(),
    upsertCannibalisation: async (i) => { rec.cannibalisation.push(i.classification); return { changed: true }; },
    loadCannibalisationHashes: async () => new Map(),
    upsertContentIntelligence: async (i) => { rec.content.push({ key: i.contentKey, classification: i.classification }); return { changed: true }; },
    loadContentHashes: async () => new Map(),
    upsertActionRequest: async (i) => {
      rec.actionRequests.push({ key: i.requestKey, state: i.state, reason: i.decisionReason });
      return { changed: true };
    },
  };
  return { m: new OrganicIntelligenceMaterialiser(ports), rec, ports };
}

describe('the pipeline writes only what changed', () => {
  it('creates on first sight and records history', async () => {
    const { m, rec } = harness();
    const r = await m.execute('INCREMENTAL');
    expect(r.counts.created).toBe(1);
    expect(rec.upserts[0].isNew).toBe(true);
    expect(rec.history[0].event).toBe('CREATED');
    expect(rec.components).toHaveLength(1);
  });

  it('performs NO domain write when nothing changed', async () => {
    // First run to learn the hashes, then replay the identical state.
    const first = harness();
    await first.m.execute('INCREMENTAL');
    const opp = first.rec.upserts[0].key;

    const evaluated = first.m.evaluate(candidate());
    const snapshots = new Map<string, StoredSnapshot>([[opp, {
      sourceHash: evaluated.sourceHash, semanticHash: evaluated.semanticHash,
      evaluationHash: evaluated.evaluationHash, policyVersion: evaluated.policyVersion,
      evidenceAvailable: evaluated.evidenceAvailable, score: evaluated.score,
      priorityBucket: evaluated.priorityBucket,
    }]]);

    const second = harness({ snapshots });
    const r = await second.m.execute('INCREMENTAL');
    expect(r.counts.unchanged).toBe(1);
    expect(r.counts.created).toBe(0);
    expect(r.counts.updated).toBe(0);
    expect(second.rec.upserts).toHaveLength(0);
    expect(second.rec.history).toHaveLength(0);
    expect(second.rec.touched).toEqual([opp]);
    expect(r.summary).toMatch(/none changed.*No domain write/i);
  });

  it('updates the SAME object when evidence moves — never duplicates', async () => {
    const base = harness();
    await base.m.execute('INCREMENTAL');
    const key = base.rec.upserts[0].key;
    const evaluated = base.m.evaluate(candidate());

    const snapshots = new Map<string, StoredSnapshot>([[key, {
      sourceHash: 'different', semanticHash: evaluated.semanticHash,
      evaluationHash: evaluated.evaluationHash, policyVersion: evaluated.policyVersion,
      evidenceAvailable: evaluated.evidenceAvailable, score: 20, priorityBucket: 'WATCH',
    }]]);
    const second = harness({ snapshots });
    const r = await second.m.execute('INCREMENTAL');

    expect(r.counts.updated).toBe(1);
    expect(r.counts.created).toBe(0);
    expect(second.rec.upserts[0].key).toBe(key);   // identity preserved
    expect(second.rec.upserts[0].isNew).toBe(false);
  });

  it('stands down rather than double-running', async () => {
    const { m, rec } = harness({ leaseHeld: true });
    const r = await m.execute();
    expect(r.ran).toBe(false);
    expect(rec.upserts).toHaveLength(0);
    expect(rec.finished).toHaveLength(0);
  });
});

describe('business truth still gates what the pipeline concludes', () => {
  it('turns high demand against a thin catalogue into EXPAND_CATALOGUE, blocked', async () => {
    const thin = candidate({
      commercial: {
        eligibleProducts: known(1), inStockProducts: known(1),
        pricingComplete: known(true), lifecycleBlocked: known(false),
      },
    });
    const { m } = harness({ candidates: [thin] });
    const opp = m.evaluate(thin);
    expect(opp.recommendedActionClass).toBe('EXPAND_CATALOGUE');
    expect(opp.commercialReadiness).toBe('CATALOGUE_THIN');
    expect(opp.priorityBucket).toBe('BLOCKED');
    expect(opp.status).toBe('BLOCKED');
  });

  it('keeps UNKNOWN demand out of the score rather than scoring it zero', async () => {
    const { m } = harness();
    const opp = m.evaluate(candidate());
    const demand = opp.components.find((c) => c.component === 'SEARCH_DEMAND')!;
    expect(demand.evidenceState).toBe('UNKNOWN');
    expect(demand.contribution).toBe(0);
    expect(demand.normalized).toBeNull();
    // Despite unknown demand the opportunity still scores on what IS known.
    expect(opp.score).toBeGreaterThan(70);
    expect(opp.evidenceMissing).toContain('SEARCH_DEMAND');
  });

  it('only puts material, confident opportunities in the human work queue', async () => {
    const lowValue = candidate({ effort: 'STRUCTURAL', risk: 'HIGH', confirmingSignals: 0, persistent: false });
    const { m, rec } = harness({ candidates: [lowValue] });
    await m.execute();
    expect(rec.workItems[0].material).toBe(false);
  });
});

describe('root causes consolidate rather than fragment', () => {
  it('emits one root cause for several symptoms sharing a template', async () => {
    const blocked = (id: string) => candidate({
      entityId: id, templateFamily: 'product', seoBlockers: ['NOINDEX'],
    });
    const { m, rec } = harness({ candidates: [blocked('/p/1'), blocked('/p/2'), blocked('/p/3'), blocked('/p/4')] });
    const r = await m.execute('FULL_REBUILD');
    expect(r.rootCauses).toBe(1);
    expect(rec.rootCauses[0]).toMatch(/^rc:product:clear-technical-blocker$/);
  });
});

describe('GSC hot-plug enriches the same object', () => {
  it('keeps the key and history while demand becomes KNOWN', async () => {
    const pre = candidate();
    const { m } = harness();
    const before = m.evaluate(pre);
    expect(before.evidenceMissing).toContain('SEARCH_DEMAND');

    const post = candidate({
      components: [
        ...pre.components.filter((c) => c.component !== 'SEARCH_DEMAND'),
        { component: 'SEARCH_DEMAND', raw: 5000, normalized: 0.8, state: 'KNOWN', reasonCode: 'gsc' },
      ],
      evidenceStates: { ...pre.evidenceStates, SEARCH_DEMAND: 'KNOWN' },
    });
    const after = m.evaluate(post);

    // THE contract: same identity, enriched evidence.
    expect(after.opportunityKey).toBe(before.opportunityKey);
    expect(after.evidenceAvailable).toContain('SEARCH_DEMAND');
    expect(after.confidence).toBe('HIGH');
    expect(before.confidence).not.toBe('HIGH');

    const verdict = classifyChange(
      {
        sourceHash: before.sourceHash, semanticHash: before.semanticHash,
        evaluationHash: before.evaluationHash, policyVersion: before.policyVersion,
        evidenceAvailable: before.evidenceAvailable, score: before.score, priorityBucket: before.priorityBucket,
      },
      {
        sourceHash: after.sourceHash, semanticHash: after.semanticHash,
        evaluationHash: after.evaluationHash, policyVersion: after.policyVersion,
        evidenceAvailable: after.evidenceAvailable, score: after.score, priorityBucket: after.priorityBucket,
      },
    );
    expect(verdict.kind).toBe('EVIDENCE_ENRICHED');
  });
});


// ── Newly wired stages ──────────────────────────────────────────────────────

describe('the engines that were built but never ran now actually run', () => {
  it('reports provider absence rather than an absence of demand', async () => {
    // The whole failure mode this guards: a stage that never executed looking
    // identical to a stage that executed and found nothing.
    const { m, rec } = harness();
    const r = await m.execute('INCREMENTAL');

    expect(r.stages.QUERY_CLUSTERS.executed).toBe(true);
    expect(r.stages.QUERY_CLUSTERS.count).toBe(0);
    expect(r.stages.QUERY_CLUSTERS.note).toMatch(/provider absence/i);
    expect(rec.clusters).toHaveLength(0);
  });

  it('clusters real queries, places their members and records ownership', async () => {
    const { m, rec } = harness({
      queryUniverse: {
        queries: [
          { raw: 'samsung battery', source: 'GSC', observedAt: '2026-08-01', isBackfill: false },
          { raw: 'samsung batteries', source: 'GSC', observedAt: '2026-08-01', isBackfill: false },
        ],
        entities: [{ entityId: 'cat-1', entityType: 'CATEGORY', label: 'Samsung Battery', terms: ['samsung', 'battery'] }],
      },
    });
    const r = await m.execute('INCREMENTAL');

    expect(r.stages.QUERY_CLUSTERS.count).toBeGreaterThan(0);
    expect(rec.clusters.length).toBeGreaterThan(0);
    expect(r.stages.QUERY_MEMBERSHIP.count).toBeGreaterThan(0);
    expect(rec.membership.length).toBeGreaterThan(0);
    // Ownership is decided as part of the cluster, not invented separately.
    expect(rec.clusters[0].ownershipDecision).toBeTruthy();
    expect(r.stages.PAGE_OWNERSHIP.executed).toBe(true);
  });

  it('carries query provenance so a backfill never reads as a live observation', async () => {
    const { m, ports } = harness({
      queryUniverse: {
        queries: [{ raw: 'old query', source: 'CSV_IMPORT', observedAt: '2025-01-01', isBackfill: true }],
        entities: [],
      },
    });
    const seen: any[] = [];
    const orig = ports.upsertQueryMembership;
    ports.upsertQueryMembership = async (i) => { seen.push(i); return orig(i); };
    await m.execute('INCREMENTAL');

    expect(seen[0].isBackfill).toBe(true);
    expect(seen[0].source).toBe('CSV_IMPORT');
  });

  it('does not rewrite a cluster whose membership signature is unchanged', async () => {
    const first = harness({
      queryUniverse: {
        queries: [{ raw: 'samsung battery', source: 'GSC', observedAt: null, isBackfill: false }],
        entities: [{ entityId: 'cat-1', entityType: 'CATEGORY', label: 'Samsung Battery', terms: ['samsung', 'battery'] }],
      },
    });
    await first.m.execute('INCREMENTAL');
    const written = first.rec.clusters[0];

    const second = harness({
      queryUniverse: {
        queries: [{ raw: 'samsung battery', source: 'GSC', observedAt: null, isBackfill: false }],
        entities: [{ entityId: 'cat-1', entityType: 'CATEGORY', label: 'Samsung Battery', terms: ['samsung', 'battery'] }],
      },
      clusterHashes: new Map([[String(written.clusterKey), String(written.membershipSignature)]]),
    });
    await second.m.execute('INCREMENTAL');
    expect(second.rec.clusters).toHaveLength(0);
  });

  it('needs two URLs before it will call anything cannibalisation', async () => {
    const { m, rec } = harness({
      queryUniverse: {
        queries: [{ raw: 'samsung battery', source: 'GSC', observedAt: null, isBackfill: false }],
        entities: [],
      },
      competingUrls: new Map([['cluster:samsung-battery', [
        { url: '/a', impressions: null, clicks: null, intent: 'COMMERCIAL', ownerType: 'CATEGORY',
          canonicalTarget: null, contentSimilarity: null, lifecycleActive: true },
      ]]]),
    });
    await m.execute('INCREMENTAL');
    // One URL cannot cannibalise itself.
    expect(rec.cannibalisation).toHaveLength(0);
  });

  it('records action requests without ever authorising them', async () => {
    const { m, rec } = harness();
    const r = await m.execute('INCREMENTAL');

    expect(r.stages.ACTION_REQUESTS.executed).toBe(true);
    for (const ar of rec.actionRequests) {
      // Autonomy level 0: nothing may persist in an executable state.
      expect(['DENIED', 'DEFERRED', 'APPROVAL_REQUIRED']).toContain(ar.state);
      expect(ar.reason.length).toBeGreaterThan(0);
    }
  });

  it('classifies content as INSUFFICIENT_EVIDENCE rather than THIN when it has no content signal', async () => {
    const url: EntityCandidate = { ...candidate(), entityType: 'URL', entityId: '/probe-page' };
    const { m, rec } = harness({ candidates: [url] });
    await m.execute('INCREMENTAL');

    expect(rec.content).toHaveLength(1);
    // THIN is a measurement; without content evidence it would be a fabrication.
    expect(rec.content[0].classification).toBe('INSUFFICIENT_EVIDENCE');
  });
});
