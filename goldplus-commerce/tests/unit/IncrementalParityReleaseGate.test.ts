import { describe, expect, it } from 'vitest';

import {
  OrganicIntelligenceMaterialiser,
  type MaterialiserPorts, type EntityCandidate,
} from '../../apps/api/src/application/use-cases/seo-growth/OrganicIntelligenceMaterialiser';
import {
  compareParity, describeMismatches, type ParityRecord,
} from '../../apps/api/src/application/use-cases/seo-growth/SemanticParity';
import { known } from '../../apps/api/src/application/use-cases/seo-growth/OrganicOpportunityScoring';

/**
 * THE release gate.
 *
 * Everything else in this tranche is preparation for one claim: that
 * evaluating only the affected entities produces the same semantic truth as
 * evaluating everything. If that is false, the portfolio silently rots — no
 * error, no failing test, just intelligence that stopped matching reality.
 *
 * The comparison is run through the REAL coordinator, not a reimplementation
 * of it, and both paths are pinned to the same source snapshot. Only one path
 * writes; the other is captured for comparison.
 */

const CATEGORIES = ['/storage', '/power', '/audio', '/car', '/batteries'];

const candidateFor = (slug: string, eligible: number): EntityCandidate => ({
  entityType: 'CATEGORY',
  entityId: slug,
  entityLabel: slug.replace('/', ''),
  templateFamily: 'category',
  commercial: {
    eligibleProducts: known(eligible, 'catalogue'),
    inStockProducts: known(Math.max(0, eligible - 1), 'inventory'),
    pricingComplete: known(true, 'catalogue'),
    lifecycleBlocked: known(false, 'lifecycle'),
  },
  seoBlockers: [],
  contentThin: eligible < 3,
  hasOwnerPage: true,
  components: [
    { component: 'CATALOGUE_DEPTH', raw: eligible, normalized: Math.min(1, eligible / 20), state: 'KNOWN', reasonCode: 'eligible_products' },
    { component: 'SEARCH_DEMAND', raw: null, normalized: null, state: 'UNKNOWN', reasonCode: 'search_console_not_connected' },
  ],
  evidenceStates: {
    COMMERCE: 'KNOWN', TECHNICAL: 'KNOWN', CONTENT: 'KNOWN',
    SEARCH_DEMAND: 'UNKNOWN', GA4: 'UNKNOWN', MERCHANT: 'UNKNOWN',
    LINK_GRAPH: 'UNKNOWN', COMPETITOR: 'UNKNOWN', GBP: 'UNKNOWN', CWV: 'UNKNOWN',
  },
  effort: 'MEDIUM', risk: 'LOW', confirmingSignals: 2, persistent: true, staleEvidence: false,
});

/** Deterministic world: the same catalogue truth for both paths. */
const WORLD = new Map(CATEGORIES.map((slug, i) => [slug, 4 + i * 3]));

function buildPorts(over: {
  changes: any[];
  captured: ParityRecord[];
  /** Simulates a planner blind spot, to prove the gate can fail. */
  breakDependency?: boolean;
}): MaterialiserPorts {
  const universe = CATEGORIES.map((entityId) => ({ entityType: 'CATEGORY' as const, entityId }));

  return {
    startRun: async () => ({ runId: 'run-parity' }),
    finishRun: async () => undefined,
    loadCandidates: async (_mode, affected) => {
      const all = CATEGORIES.map((slug) => candidateFor(slug, WORLD.get(slug)!));
      if (affected === null) return all;
      const wanted = new Set(affected.map((a) => a.entityId));
      return all.filter((c) => wanted.has(c.entityId));
    },
    loadUniverse: async () => universe,
    resolveChanges: async () => ({
      // Both paths are pinned to the SAME snapshot: a comparison across
      // different source states would prove nothing.
      snapshotId: 'snapshot-fixed',
      changes: over.changes,
      coverageLimits: [],
      commit: async () => undefined,
    }),
    dependencyResolver: async () => ({
      categoriesForProduct: (productId) =>
        // The dependency under test: a product change must reach its category.
        over.breakDependency ? [] : [productId === 'p-power' ? '/power' : '/storage'],
      urlsForEntity: () => [],
      clustersForUrl: () => [],
      answerUnitsForFact: () => [],
      linkSourcesForUrl: () => [],
    }),
    loadSnapshots: async () => new Map(),
    upsertOpportunity: async (i) => {
      over.captured.push({
        domain: 'OPPORTUNITIES',
        entityKey: i.opportunity.opportunityKey,
        fields: {
          score: i.opportunity.score,
          adjustedScore: i.opportunity.adjustedScore,
          bucket: i.opportunity.priorityBucket,
          action: i.opportunity.recommendedActionClass,
          confidence: i.opportunity.confidence,
          commercial: i.opportunity.commercialReadiness,
          blockedBy: i.opportunity.blockedBy,
          evidenceMissing: i.opportunity.evidenceMissing,
          run_id: 'differs-between-runs',
        },
      });
    },
    writeComponents: async (i) => {
      for (const c of i.components) {
        over.captured.push({
          domain: 'SCORE_COMPONENTS',
          entityKey: `${i.opportunityKey}::${c.component}`,
          fields: { state: c.evidenceState, normalized: c.normalized, weight: c.weight, reason: c.reasonCode },
        });
      }
    },
    writeHistory: async () => undefined,
    touchSeen: async () => undefined,
    upsertRootCause: async (i) => {
      over.captured.push({ domain: 'ROOT_CAUSES', entityKey: i.rootCauseKey, fields: { summary: i.summary, unlocked: i.unlockedScore } });
    },
    reconcileWorkItem: async (i) => {
      over.captured.push({ domain: 'WORK_ITEMS', entityKey: i.opportunityKey, fields: { material: i.material, priority: i.priority } });
      return { workItemId: i.material ? 'wi' : null, created: i.material, updated: false };
    },
    linkWorkItem: async () => undefined,
    loadQueryUniverse: async () => ({ queries: [], entities: [] }),
    upsertCluster: async () => ({ changed: true }),
    loadClusterHashes: async () => new Map(),
    upsertQueryMembership: async () => ({ changed: true }),
    loadMembershipKeys: async () => new Set(),
    loadCompetingUrls: async () => new Map(),
    upsertCannibalisation: async () => ({ changed: true }),
    loadCannibalisationHashes: async () => new Map(),
    upsertContentIntelligence: async () => ({ changed: true }),
    loadContentHashes: async () => new Map(),
    upsertActionRequest: async (i) => {
      over.captured.push({ domain: 'ACTION_REQUESTS', entityKey: i.requestKey, fields: { state: i.state, actionClass: i.actionClass, unmet: i.unmetPreconditions } });
      return { changed: true };
    },
    loadAnswerUnitDrafts: async () => [],
    upsertAnswerUnit: async () => ({ changed: true }),
    loadAnswerUnitHashes: async () => new Map(),
  };
}

async function runPath(changes: any[], mode: 'INCREMENTAL' | 'FULL_REBUILD', breakDependency = false) {
  const captured: ParityRecord[] = [];
  const ports = buildPorts({ changes, captured, breakDependency });
  const result = await new OrganicIntelligenceMaterialiser(ports).execute(mode);
  return { captured, result };
}

describe('INCREMENTAL_EQUIVALENCE_RELEASE_GATE', () => {
  it('a single product change produces the same semantic truth as a full rebuild', async () => {
    const changes = [{ source: 'PRODUCT', entityId: 'p-power', changeType: 'UPDATED' }];
    const inc = await runPath(changes, 'INCREMENTAL');
    const full = await runPath(changes, 'FULL_REBUILD');

    // The incremental run must genuinely have narrowed, or this proves nothing.
    expect(inc.result.executionMode).toBe('INCREMENTAL_EXACT');
    expect(inc.result.counts.entitiesEvaluated).toBeLessThan(full.result.counts.entitiesEvaluated);

    const affected = new Set(inc.captured.map((r) => `${r.domain}::${r.entityKey}`));
    const verdict = compareParity({
      incrementalSnapshotId: inc.result.sourceSnapshotId,
      fullSnapshotId: full.result.sourceSnapshotId,
      incremental: inc.captured,
      // Compare over the entities the incremental run was responsible for:
      // the rebuild legitimately also recomputes untouched ones.
      full: full.captured.filter((r) => affected.has(`${r.domain}::${r.entityKey}`)),
    });

    expect(describeMismatches(verdict.mismatches)).toEqual([]);
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.recordsCompared).toBeGreaterThan(0);
  });

  it('a category change produces the same semantic truth as a full rebuild', async () => {
    const changes = [{ source: 'CATEGORY', entityId: '/audio', changeType: 'UPDATED' }];
    const inc = await runPath(changes, 'INCREMENTAL');
    const full = await runPath(changes, 'FULL_REBUILD');

    const affected = new Set(inc.captured.map((r) => `${r.domain}::${r.entityKey}`));
    const verdict = compareParity({
      incrementalSnapshotId: inc.result.sourceSnapshotId,
      fullSnapshotId: full.result.sourceSnapshotId,
      incremental: inc.captured,
      full: full.captured.filter((r) => affected.has(`${r.domain}::${r.entityKey}`)),
    });
    expect(verdict.verdict).toBe('PASS');
  });

  it('a global policy change matches the full rebuild exactly, record for record', async () => {
    const changes = [{ source: 'POLICY', entityId: 'scoring', changeType: 'UPDATED' }];
    const inc = await runPath(changes, 'INCREMENTAL');
    const full = await runPath(changes, 'FULL_REBUILD');

    // Nothing is narrowed here, so the comparison is total.
    const verdict = compareParity({
      incrementalSnapshotId: inc.result.sourceSnapshotId,
      fullSnapshotId: full.result.sourceSnapshotId,
      incremental: inc.captured,
      full: full.captured,
    });
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.recordsCompared).toBe(full.captured.length);
  });

  it('DETECTS a missing dependency edge instead of passing quietly', async () => {
    // This is the proof that the gate can fail. With the product -> category
    // edge severed, the incremental run never evaluates the affected category,
    // and the full rebuild does.
    const changes = [{ source: 'PRODUCT', entityId: 'p-power', changeType: 'UPDATED' }];
    const inc = await runPath(changes, 'INCREMENTAL', true);
    const full = await runPath(changes, 'FULL_REBUILD');

    const verdict = compareParity({
      incrementalSnapshotId: inc.result.sourceSnapshotId,
      fullSnapshotId: full.result.sourceSnapshotId,
      incremental: inc.captured,
      full: full.captured,
    });

    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.mismatches.some((m) => m.presence === 'FULL_ONLY')).toBe(true);
    // And it must say WHERE, or an operator cannot act on it.
    expect(describeMismatches(verdict.mismatches).join(' ')).toMatch(/never marked it affected/i);
  });

  it('refuses to compare runs that read different source states', async () => {
    const inc = await runPath([{ source: 'CATEGORY', entityId: '/audio', changeType: 'UPDATED' }], 'INCREMENTAL');
    const verdict = compareParity({
      incrementalSnapshotId: inc.result.sourceSnapshotId,
      fullSnapshotId: 'a-different-snapshot',
      incremental: inc.captured,
      full: inc.captured,
    });
    expect(verdict.verdict).toBe('INCONCLUSIVE');
  });
});
