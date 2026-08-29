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
  changes?: any[];
  universe?: any[];
  snapshotId?: string;
  resolverAbsent?: boolean;
  dependencies?: Partial<Record<string, any>>;
  answerDrafts?: any[];
  answerHashes?: Map<string, string>;
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
    /** What loadCandidates was actually asked to load. */
    loadedWith: [] as Array<any[] | null>,
    cursorCommits: 0,
    answerUnits: [] as Array<{ key: string; readiness: string; blocked: string | null }>,
    answerDraftKeys: [] as Array<string[] | null>,
    workItems: [] as Array<{ key: string; material: boolean }>,
    links: [] as string[],
    finished: [] as Array<Record<string, unknown>>,
  };
  const ports: MaterialiserPorts = {
    startRun: async () => (over.leaseHeld ? null : { runId: 'run-1' }),
    finishRun: async (f) => { rec.finished.push(f as unknown as Record<string, unknown>); },
    loadCandidates: async (_mode, affected) => {
      rec.loadedWith.push(affected);
      const all = over.candidates ?? [candidate()];
      // A port that ignored `affected` would make "incremental" a label again,
      // so the fake honours it exactly as the real one must.
      if (affected === null) return all;
      // Mirrors the real port: the category/URL namespace is shared, so the
      // affected set is deduplicated by id before loading.
      const wanted = new Set(affected.map((a: any) => a.entityId));
      return all.filter((c) => wanted.has(c.entityId));
    },
    loadUniverse: async () => over.universe ?? [{ entityType: 'CATEGORY', entityId: '/storage' }],
    resolveChanges: async () => over.resolverAbsent ? null : ({
      snapshotId: over.snapshotId ?? 'snap-1',
      // The default is "the candidate's own category changed", because these
      // suites exercise the write pipeline, not the planner. With no changes at
      // all a truly incremental run correctly evaluates nothing — which is the
      // whole point of this tranche, and is asserted separately below.
      changes: over.changes ?? [{ source: 'CATEGORY', entityId: '/storage', changeType: 'UPDATED' }],
      coverageLimits: ['products: deletion detected by INVENTORY_DIFF'],
      commit: async () => { rec.cursorCommits += 1; },
    }),
    dependencyResolver: async () => ({
      categoriesForProduct: () => over.dependencies?.categoriesForProduct?.() ?? ['/storage'],
      urlsForEntity: (r: any) => (r.entityType === 'CATEGORY' ? [r.entityId] : []),
      clustersForUrl: () => [],
      answerUnitsForFact: () => over.dependencies?.answerUnitsForFact?.() ?? [],
      linkSourcesForUrl: () => [],
    }),
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
    loadAnswerUnitDrafts: async (keys) => {
      rec.answerDraftKeys.push(keys);
      const all = over.answerDrafts ?? [];
      if (keys === null) return all as any;
      const wanted = new Set(keys);
      return all.filter((d: any) => wanted.has(`${d.templateId}::${d.entityContext}`)) as any;
    },
    upsertAnswerUnit: async (i) => {
      rec.answerUnits.push({ key: i.answerKey, readiness: i.readiness, blocked: i.blockedReason });
      return { changed: true };
    },
    loadAnswerUnitHashes: async () => over.answerHashes ?? new Map(),

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
      // The clusterer emits `cl:`-prefixed keys. This map was keyed
      // 'cluster:samsung-battery', which matched nothing, so the assertion below
      // passed without a single URL ever being loaded.
      competingUrls: new Map([['cl:samsung-battery', [
        { url: '/a', impressions: null, clicks: null, intent: 'COMMERCIAL', ownerType: 'CATEGORY',
          canonicalTarget: null, contentSimilarity: null, lifecycleActive: true, providerObserved: false },
      ]]]),
    });
    await m.execute('INCREMENTAL');
    // One URL cannot cannibalise itself.
    expect(rec.cannibalisation).toHaveLength(0);
  });

  it('believes an owner the search provider actually observed, and not a lexical guess', async () => {
    // Ownership is a claim about observed reality. Search Console reports which
    // PAGE it served for which QUERY; a URL that merely contains the query text
    // is a guess. Every candidate used to be sent in as the guess, so every
    // owner was discarded as untrusted and the module produced no opportunities
    // at all.
    const observed = harness({
      queryUniverse: {
        queries: [{ raw: 'samsung battery', source: 'GSC', observedAt: null, isBackfill: false }],
        entities: [],
      },
      competingUrls: new Map([['cl:samsung-battery', [
        { url: 'https://shopgoldplus.com/products/samsung-battery', impressions: 40, clicks: 3,
          intent: 'COMMERCIAL', ownerType: 'PRODUCT', canonicalTarget: null,
          contentSimilarity: null, lifecycleActive: true, providerObserved: true },
      ]]]),
    });
    await observed.m.execute('INCREMENTAL');
    const withProvider = observed.rec.clusters.find((c) => c.currentOwnerUrl);
    expect(withProvider?.currentOwnerUrl).toBe('https://shopgoldplus.com/products/samsung-battery');

    const guessed = harness({
      queryUniverse: {
        queries: [{ raw: 'samsung battery', source: 'GSC', observedAt: null, isBackfill: false }],
        entities: [],
      },
      competingUrls: new Map([['cl:samsung-battery', [
        { url: 'https://shopgoldplus.com/blog/samsung-battery-tips', impressions: null, clicks: null,
          intent: 'COMMERCIAL', ownerType: 'PRODUCT', canonicalTarget: null,
          contentSimilarity: null, lifecycleActive: true, providerObserved: false },
      ]]]),
    });
    await guessed.m.execute('INCREMENTAL');
    // Recorded as a candidate, but never asserted as the owner.
    expect(guessed.rec.clusters.every((c) => !c.currentOwnerUrl)).toBe(true);
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
    const { m, rec } = harness({
      candidates: [url],
      changes: [{ source: 'CONTENT', entityId: '/probe-page', changeType: 'UPDATED' }],
      universe: [{ entityType: 'URL', entityId: '/probe-page' }],
    });
    await m.execute('INCREMENTAL');

    expect(rec.content).toHaveLength(1);
    // THIN is a measurement; without content evidence it would be a fabrication.
    expect(rec.content[0].classification).toBe('INSUFFICIENT_EVIDENCE');
  });
});

// ── The planner actually drives execution (§9, §11, §18) ────────────────────

describe('incremental is narrowed by the planner, not merely labelled', () => {
  const UNIVERSE = [
    { entityType: 'CATEGORY' as const, entityId: '/storage' },
    { entityType: 'CATEGORY' as const, entityId: '/power' },
    { entityType: 'CATEGORY' as const, entityId: '/audio' },
    { entityType: 'CATEGORY' as const, entityId: '/car' },
  ];
  const CANDIDATES = UNIVERSE.map((u) => ({ ...candidate(), entityId: u.entityId, entityLabel: u.entityId }));

  it('loads ONLY the affected entities when the plan is exact', async () => {
    const { m, rec } = harness({
      universe: UNIVERSE, candidates: CANDIDATES,
      changes: [{ source: 'CATEGORY', entityId: '/power', changeType: 'UPDATED' }],
    });
    const r = await m.execute('INCREMENTAL');

    // The load was narrowed, not filtered afterwards.
    expect(rec.loadedWith[0]).not.toBeNull();
    expect([...new Set(rec.loadedWith[0]!.map((a: any) => a.entityId))]).toEqual(['/power']);
    expect(r.counts.entitiesEvaluated).toBe(1);
    expect(r.executionMode).toBe('INCREMENTAL_EXACT');
  });

  it('reports work reduction honestly', async () => {
    const { m } = harness({
      universe: UNIVERSE, candidates: CANDIDATES,
      changes: [{ source: 'CATEGORY', entityId: '/power', changeType: 'UPDATED' }],
    });
    const r = await m.execute('INCREMENTAL');

    expect(r.planning).not.toBeNull();
    expect(r.planning!.totalEligible).toBe(4);
    // The planner may name one entity under two types; what matters is that
    // exactly one candidate was evaluated and three were skipped.
    expect(r.counts.entitiesEvaluated).toBe(1);
    expect(r.planning!.totalEligible - r.counts.entitiesEvaluated).toBe(3);
  });

  it('follows a product change into its category rather than stopping at the product', async () => {
    const { m, rec } = harness({
      universe: UNIVERSE, candidates: CANDIDATES,
      changes: [{ source: 'PRODUCT', entityId: 'p-1', changeType: 'UPDATED' }],
      dependencies: { categoriesForProduct: () => ['/storage'] },
    });
    await m.execute('INCREMENTAL');

    const loaded = rec.loadedWith[0]!.map((a: any) => a.entityId);
    expect(loaded).toContain('/storage');
    expect(loaded).not.toContain('/audio');
  });

  it('evaluates NOTHING when no source change occurred', async () => {
    const { m, rec } = harness({ universe: UNIVERSE, candidates: CANDIDATES, changes: [] });
    const r = await m.execute('INCREMENTAL');

    // The honest answer to "what changed?" being "nothing" is not a reason to
    // recompute the world.
    expect(r.counts.entitiesEvaluated).toBe(0);
    expect(rec.upserts).toHaveLength(0);
  });

  it('loads the whole universe when a policy change makes the run global', async () => {
    const { m, rec } = harness({
      universe: UNIVERSE, candidates: CANDIDATES,
      changes: [{ source: 'POLICY', entityId: 'scoring', changeType: 'UPDATED' }],
    });
    const r = await m.execute('INCREMENTAL');

    expect(rec.loadedWith[0]).toBeNull();
    expect(r.counts.entitiesEvaluated).toBe(4);
    // A global run must not describe itself as incremental.
    expect(r.executionMode).toBe('FULL_REBUILD');
  });

  it('widens rather than narrow when a change source has no dependency rule', async () => {
    const { m, rec } = harness({
      universe: UNIVERSE, candidates: CANDIDATES,
      changes: [{ source: 'UNKNOWN', entityId: '???', changeType: 'UPDATED' }],
    });
    const r = await m.execute('INCREMENTAL');

    expect(rec.loadedWith[0]).toBeNull();
    expect(r.executionMode).toBe('INCREMENTAL_EXPANDED');
  });

  it('never narrows a FULL_REBUILD', async () => {
    const { m, rec } = harness({ universe: UNIVERSE, candidates: CANDIDATES });
    const r = await m.execute('FULL_REBUILD');

    expect(rec.loadedWith[0]).toBeNull();
    expect(r.counts.entitiesEvaluated).toBe(4);
    expect(r.executionMode).toBe('FULL_REBUILD');
  });

  it('attributes the result to a source snapshot', async () => {
    const { m } = harness({ universe: UNIVERSE, candidates: CANDIDATES, snapshotId: 'snap-xyz' });
    const r = await m.execute('INCREMENTAL');
    expect(r.sourceSnapshotId).toBe('snap-xyz');
  });

  it('surfaces the deletion coverage limit rather than implying exactness', async () => {
    const { m } = harness({ universe: UNIVERSE, candidates: CANDIDATES });
    const r = await m.execute('INCREMENTAL');
    expect(r.planning!.coverageLimits.join(' ')).toMatch(/INVENTORY_DIFF/);
  });
});

// ── Cursor commitment (§4, §41) ─────────────────────────────────────────────

describe('the source cursor advances only after a successful run', () => {
  it('commits the cursor when the run completes', async () => {
    const { m, rec } = harness();
    await m.execute('INCREMENTAL');
    expect(rec.cursorCommits).toBe(1);
  });

  it('does NOT commit the cursor when the run fails', async () => {
    const { m, rec, ports } = harness();
    ports.upsertOpportunity = async () => { throw new Error('storage exploded'); };
    const r = await m.execute('INCREMENTAL');

    // If the cursor advanced here, the change would be lost forever: the next
    // run would start after it and never see it again.
    expect(r.summary).toMatch(/failed and was contained/i);
    expect(rec.cursorCommits).toBe(0);
  });

  it('does not commit a cursor when it never resolved changes', async () => {
    const { m, rec } = harness({ resolverAbsent: true });
    await m.execute('INCREMENTAL');
    expect(rec.cursorCommits).toBe(0);
  });
});

// ── AEO fact invalidation, end to end (§37, §38) ────────────────────────────

/** A draft whose facts are all present and verified — this may reach READY. */
const groundedDraft = (productId = 'p-1') => ({
  templateId: 'product-availability',
  entityContext: 'solar-panel',
  question: 'Is the solar panel available, and what does it cost?',
  intent: 'PRICE',
  answerType: 'PRICE',
  requiredFactKeys: [`price:${productId}`, `availability:${productId}`],
  availableFacts: [
    { key: `price:${productId}`, value: '450000', source: 'CATALOGUE', sourceId: productId, verified: true },
    { key: `availability:${productId}`, value: '12', source: 'CATALOGUE', sourceId: productId, verified: true },
  ],
  productEntities: [productId],
  categoryEntities: ['/power'],
});

/** The same unit after its price fact disappeared from the catalogue. */
const ungroundedDraft = (productId = 'p-1') => ({
  ...groundedDraft(productId),
  availableFacts: groundedDraft(productId).availableFacts.filter((f) => !f.key.startsWith('price:')),
});

describe('an answer unit cannot stay READY once its grounding fact disappears', () => {
  it('reaches READY while every required fact is present and verified', async () => {
    const { m, rec } = harness({ answerDrafts: [groundedDraft()] });
    const r = await m.execute('FULL_REBUILD');

    expect(r.stages.ANSWER_UNITS.executed).toBe(true);
    expect(rec.answerUnits).toHaveLength(1);
    expect(rec.answerUnits[0].readiness).toBe('READY');
  });

  it('leaves READY when a required fact is removed, and says why', async () => {
    const { m, rec } = harness({ answerDrafts: [ungroundedDraft()] });
    await m.execute('FULL_REBUILD');

    const unit = rec.answerUnits[0];
    // The core AEO safety property: no stale READY answer survives.
    expect(unit.readiness).not.toBe('READY');
    expect(unit.readiness).toBe('BLOCKED_BY_MISSING_FACT');
    expect(unit.blocked).toBeTruthy();
  });

  it('keeps the SAME semantic identity across the transition', async () => {
    const before = harness({ answerDrafts: [groundedDraft()] });
    await before.m.execute('FULL_REBUILD');
    const after = harness({ answerDrafts: [ungroundedDraft()] });
    await after.m.execute('FULL_REBUILD');

    // Identity must survive invalidation, or the history and the work item
    // detach from their subject.
    expect(after.rec.answerUnits[0].key).toBe(before.rec.answerUnits[0].key);
  });

  it('re-evaluates a unit the planner marked as fact-affected', async () => {
    const { m, rec } = harness({
      answerDrafts: [ungroundedDraft()],
      changes: [{ source: 'FACT', entityId: 'price:p-1', changeType: 'DELETED' }],
      dependencies: { answerUnitsForFact: () => ['product-availability::solar-panel'] },
    });
    await m.execute('INCREMENTAL');

    // The planner named it, so the drafts were narrowed to exactly it.
    expect(rec.answerDraftKeys[0]).toEqual(['product-availability::solar-panel']);
    expect(rec.answerUnits[0].readiness).toBe('BLOCKED_BY_MISSING_FACT');
  });

  it('does not re-evaluate answer units when no fact changed', async () => {
    const { m, rec } = harness({
      answerDrafts: [groundedDraft()],
      changes: [{ source: 'CATEGORY', entityId: '/storage', changeType: 'UPDATED' }],
    });
    const r = await m.execute('INCREMENTAL');

    expect(rec.answerDraftKeys[0]).toEqual([]);
    expect(rec.answerUnits).toHaveLength(0);
    // Executed and found nothing to do — not "never ran".
    expect(r.stages.ANSWER_UNITS.executed).toBe(true);
    expect(r.stages.ANSWER_UNITS.note).toMatch(/no fact/i);
  });

  it('evaluates every unit on a full rebuild', async () => {
    const { m, rec } = harness({ answerDrafts: [groundedDraft('p-1'), groundedDraft('p-2')] });
    await m.execute('FULL_REBUILD');
    expect(rec.answerDraftKeys[0]).toBeNull();
    expect(rec.answerUnits).toHaveLength(2);
  });
});

// ── Provider activation through the coordinator (§19, §23, §24) ─────────────

/** The same category, before and after Search Console reports demand. */
const demandBlind = (): EntityCandidate => ({
  ...candidate(),
  entityId: '/power',
  components: [
    { component: 'CATALOGUE_DEPTH', raw: 8, normalized: 0.4, state: 'KNOWN', reasonCode: 'eligible_products' },
    { component: 'SEARCH_DEMAND', raw: null, normalized: null, state: 'UNKNOWN', reasonCode: 'search_console_not_connected' },
  ],
  evidenceStates: { ...candidate().evidenceStates, SEARCH_DEMAND: 'UNKNOWN' },
});

/** Mirrors the runner's fixed-grid banding, which is what removes daily noise. */
const band = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const step = Math.max(1, 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1));
  return Math.round(n / step) * step;
};

const demandKnown = (impressions = 5000): EntityCandidate => ({
  ...demandBlind(),
  components: [
    { component: 'CATALOGUE_DEPTH', raw: 8, normalized: 0.4, state: 'KNOWN', reasonCode: 'eligible_products' },
    {
      component: 'SEARCH_DEMAND',
      raw: { impressions: band(impressions), clicks: band(120), queries: 40 },
      normalized: Math.min(1, Math.log10(band(impressions) + 1) / 6),
      state: 'KNOWN', reasonCode: 'gsc_observed_impressions',
    },
  ],
  evidenceStates: { ...demandBlind().evidenceStates, SEARCH_DEMAND: 'KNOWN' },
  sourcePeriodStart: '2026-07-01',
  sourcePeriodEnd: '2026-08-12',
});

describe('connecting Search Console enriches opportunities rather than replacing them', () => {
  it('reports PROVIDER_INITIAL_ENRICHMENT rather than a bare full rebuild', async () => {
    const { m } = harness({
      candidates: [demandBlind()],
      universe: [{ entityType: 'CATEGORY', entityId: '/power' }],
      changes: [{ source: 'PROVIDER_CONNECTED', entityId: 'gsc:conn-1:v1', changeType: 'PROVIDER_ENRICHED' }],
    });
    const r = await m.execute('INCREMENTAL');

    expect(r.executionMode).toBe('PROVIDER_INITIAL_ENRICHMENT');
    // It still evaluates everything — that is correct, and now it says why.
    expect(r.counts.entitiesEvaluated).toBe(1);
  });

  it('keeps the SAME opportunity key when demand becomes known', async () => {
    const before = harness({ candidates: [demandBlind()] });
    await before.m.execute('FULL_REBUILD');
    const after = harness({ candidates: [demandKnown()] });
    await after.m.execute('FULL_REBUILD');

    // Never a "GSC opportunity" replacing the pre-GSC one.
    expect(after.rec.upserts[0].key).toBe(before.rec.upserts[0].key);
  });

  it('moves SEARCH_DEMAND from UNKNOWN to KNOWN, never to zero', async () => {
    const blind = harness().m.evaluate(demandBlind());
    const known = harness().m.evaluate(demandKnown());

    expect(blind.evidenceMissing).toContain('SEARCH_DEMAND');
    expect(known.evidenceMissing).not.toContain('SEARCH_DEMAND');
    expect(known.evidenceAvailable).toContain('SEARCH_DEMAND');

    const blindComponent = blind.components.find((c) => c.component === 'SEARCH_DEMAND')!;
    const knownComponent = known.components.find((c) => c.component === 'SEARCH_DEMAND')!;
    expect(blindComponent.evidenceState).toBe('UNKNOWN');
    expect(blindComponent.raw).toBeNull();
    expect(knownComponent.evidenceState).toBe('KNOWN');
    // The distinction the whole evidence model rests on.
    expect(blindComponent.normalized).not.toBe(0);
    expect(blindComponent.normalized).toBeNull();
  });

  it('raises evidence completeness and can raise confidence', async () => {
    const blind = harness().m.evaluate(demandBlind());
    const known = harness().m.evaluate(demandKnown());
    expect(known.evidenceCompleteness).toBeGreaterThan(blind.evidenceCompleteness);
  });

  it('records the observation period so a partial window is not read as complete', async () => {
    const known = harness().m.evaluate(demandKnown());
    expect(known.sourcePeriodStart).toBe('2026-07-01');
    expect(known.sourcePeriodEnd).toBe('2026-08-12');
  });

  it('writes a material change when demand genuinely arrives', async () => {
    const first = harness({ candidates: [demandBlind()] });
    await first.m.execute('FULL_REBUILD');
    const evaluated = first.m.evaluate(demandBlind());

    const second = harness({
      candidates: [demandKnown()],
      snapshots: new Map([[evaluated.opportunityKey, {
        sourceHash: evaluated.sourceHash, semanticHash: evaluated.semanticHash,
        evaluationHash: evaluated.evaluationHash, policyVersion: evaluated.policyVersion,
        evidenceAvailable: evaluated.evidenceAvailable, score: evaluated.score,
        priorityBucket: evaluated.priorityBucket,
      }]]),
    });
    const r = await second.m.execute('FULL_REBUILD');
    expect(r.counts.updated).toBe(1);
    expect(second.rec.history.length).toBeGreaterThan(0);
  });

  it('writes NOTHING when the same demand evidence is seen again', async () => {
    const first = harness({ candidates: [demandKnown()] });
    await first.m.execute('FULL_REBUILD');
    const evaluated = first.m.evaluate(demandKnown());

    const second = harness({
      candidates: [demandKnown()],
      snapshots: new Map([[evaluated.opportunityKey, {
        sourceHash: evaluated.sourceHash, semanticHash: evaluated.semanticHash,
        evaluationHash: evaluated.evaluationHash, policyVersion: evaluated.policyVersion,
        evidenceAvailable: evaluated.evidenceAvailable, score: evaluated.score,
        priorityBucket: evaluated.priorityBucket,
      }]]),
    });
    const r = await second.m.execute('FULL_REBUILD');
    expect(r.counts.unchanged).toBe(1);
    expect(second.rec.upserts).toHaveLength(0);
    expect(second.rec.history).toHaveLength(0);
  });

  it('does not churn on an immaterial demand movement', async () => {
    const base = harness({ candidates: [demandKnown(5000)] });
    await base.m.execute('FULL_REBUILD');
    const evaluated = base.m.evaluate(demandKnown(5000));

    // A handful of extra impressions is noise, not a finding.
    const nudged = harness({
      candidates: [demandKnown(5003)],
      snapshots: new Map([[evaluated.opportunityKey, {
        sourceHash: evaluated.sourceHash, semanticHash: evaluated.semanticHash,
        evaluationHash: evaluated.evaluationHash, policyVersion: evaluated.policyVersion,
        evidenceAvailable: evaluated.evidenceAvailable, score: evaluated.score,
        priorityBucket: evaluated.priorityBucket,
      }]]),
    });
    const r = await nudged.m.execute('FULL_REBUILD');
    // Churn is measured by domain writes and history, not by the work-queue
    // reconcile call, which runs for every opportunity on every pass.
    expect(r.counts.unchanged).toBe(1);
    expect(r.counts.updated).toBe(0);
    expect(nudged.rec.upserts).toHaveLength(0);
    expect(nudged.rec.history).toHaveLength(0);
  });

  it('creates no Guardian incident from historical backfill', async () => {
    // Materialisation writes to seo_intel_* and the work queue only. Nothing
    // in this path opens an incident, so a 16-month backfill cannot manufacture
    // a "current" SEO emergency.
    const { m, rec } = harness({
      candidates: [demandKnown()],
      changes: [{ source: 'PROVIDER_CONNECTED', entityId: 'gsc:conn-1:v1', changeType: 'PROVIDER_ENRICHED' }],
      universe: [{ entityType: 'CATEGORY', entityId: '/power' }],
    });
    await m.execute('INCREMENTAL');
    expect(rec.actionRequests.every((a) => a.state !== 'PROPOSED')).toBe(true);
  });
});
