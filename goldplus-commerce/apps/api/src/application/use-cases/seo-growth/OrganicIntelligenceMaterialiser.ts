import {
  opportunityKey, clusterKey, answerKey, rootCauseKey,
  sourceHash, semanticHash, evaluationHash, factHash,
  classifyChange, ENGINE_VERSION, MATERIALISATION_VERSION,
  type ChangeKind, type StoredSnapshot, type EntityType,
} from './OrganicIntelligenceIdentity';
import {
  assessEvidenceCoverage, assessConfidence, assessCommercialReadiness,
  assessSeoReadiness, scoreOpportunity, prioritise, recommendedAction,
  SCORING_POLICY_VERSION,
  type EvidenceDimension, type EvidenceState, type ScoreComponent,
  type CommercialInput, type SeoBlocker, type Effort, type Risk, type ActionClass,
} from './OrganicOpportunityScoring';
import {
  consolidateRootCauses, evaluateActionRequest, catalogueEntry,
  type OpportunitySymptom,
} from './OpportunityPortfolio';
import { buildAnswerUnit, type AnswerUnitDraft } from './AnswerUnitEngine';
import {
  clusterQueries, classifyIntent, resolveOwnership, classifyCannibalisation, intentConsensus,
  type ClusterEntity, type Intent, type OwnerType,
} from './QueryIntelligence';
import {
  planAffectedEntities, planEfficiency,
  type EntityRef, type SourceChange, type DependencyResolver, type AffectedPlan,
} from './AffectedEntityPlanner';

/**
 * THE single materialisation boundary.
 *
 * Seven engines produce findings; exactly one component decides what reaches
 * storage. If each engine wrote for itself there would be no way to guarantee
 * the invariant this tranche turns on:
 *
 *     UNCHANGED SEMANTIC STATE => NO DOMAIN WRITE
 *
 * The pipeline is: load -> evaluate -> diff -> persist only transitions ->
 * reconcile work queue -> audit. Every step is expressed over ports so the
 * whole thing is provable with fakes AND against real PostgreSQL.
 */

export const MATERIALISATION_MODES = ['INCREMENTAL', 'FULL_REBUILD', 'BACKFILL', 'REPLAY'] as const;
export type MaterialisationMode = (typeof MATERIALISATION_MODES)[number];

/**
 * What the run ACTUALLY did, as opposed to what it was asked to do. A run that
 * evaluated the whole universe must never report itself as INCREMENTAL — the
 * label is how the previous implementation hid the fact that nothing was being
 * narrowed.
 */
export const EXECUTION_MODES = [
  'INCREMENTAL_EXACT',
  'INCREMENTAL_EXPANDED',
  'FULL_FALLBACK',
  'FULL_REBUILD',
  'PROVIDER_INITIAL_ENRICHMENT',
] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** One entity the pipeline may form an opinion about. */
export interface EntityCandidate {
  entityType: EntityType;
  entityId: string;
  entityLabel?: string;
  templateFamily?: string | null;

  /** Commercial truth from the catalogue — the authority on readiness. */
  commercial: CommercialInput;
  /** Technical truth from the crawler / governance engines. */
  seoBlockers: SeoBlocker[];
  contentThin: boolean;
  hasOwnerPage: boolean;

  /** Scoring inputs. UNKNOWN state means the component is skipped, not zeroed. */
  components: Array<{
    component: ScoreComponent;
    raw: unknown;
    normalized: number | null;
    state: EvidenceState;
    reasonCode: string;
  }>;
  evidenceStates: Partial<Record<EvidenceDimension, EvidenceState>>;

  effort: Effort;
  risk: Risk;
  confirmingSignals: number;
  persistent: boolean;
  staleEvidence: boolean;

  /** Provenance — observation time is not ingestion time. */
  sourceObservedAt?: string | null;
  sourcePeriodStart?: string | null;
  sourcePeriodEnd?: string | null;
}

export interface MaterialisedOpportunity {
  opportunityKey: string;
  opportunityClass: string;
  entityType: EntityType;
  entityId: string;
  entityLabel: string | null;
  rootCauseKey: string | null;
  policyVersion: string;
  engineVersion: string;
  materialisationVersion: number;
  sourceHash: string;
  semanticHash: string;
  evaluationHash: string;
  score: number | null;
  adjustedScore: number | null;
  unscoredWeightShare: number | null;
  commercialReadiness: string;
  seoReady: boolean;
  contentReady: boolean;
  seoBlockers: string[];
  confidence: string;
  evidenceCompleteness: number;
  evidenceAvailable: string[];
  evidenceMissing: string[];
  effort: Effort;
  risk: Risk;
  priorityBucket: string;
  recommendedActionClass: string;
  blockedBy: string[];
  status: string;
  components: Array<{
    component: string; raw: unknown; evidenceState: string;
    normalized: number | null; weight: number; contribution: number; reasonCode: string;
  }>;
  sourceObservedAt: string | null;
  sourcePeriodStart: string | null;
  sourcePeriodEnd: string | null;
  explanation: string;
}

export interface MaterialiserPorts {
  startRun(input: { mode: MaterialisationMode; policyVersion: string; engineVersion: string; materialisationVersion: number }): Promise<{ runId: string } | null>;
  finishRun(input: {
    runId: string; status: 'COMPLETED' | 'FAILED'; counts: RunCounts;
    evidenceState: Record<string, unknown>; error?: string;
  }): Promise<void>;

  /**
   * Entities to evaluate.
   *
   * `affected` is the planner's output. When it is present the port MUST load
   * only those entities — a port that ignores it and returns the whole
   * universe turns "incremental" back into a label, which is the exact defect
   * this closure tranche exists to fix. When it is null (FULL_REBUILD,
   * FULL_FALLBACK, GLOBAL) the full universe is correct.
   */
  loadCandidates(mode: MaterialisationMode, affected: EntityRef[] | null): Promise<EntityCandidate[]>;

  /** Everything evaluable, for planner fallback and work-reduction reporting. */
  loadUniverse(): Promise<EntityRef[]>;
  /** Resolves what changed since the last successful materialisation. */
  resolveChanges(): Promise<{
    snapshotId: string;
    changes: SourceChange[];
    coverageLimits: string[];
    commit(): Promise<void>;
  } | null>;
  /** The dependency graph the planner walks. */
  dependencyResolver(): Promise<DependencyResolver>;
  /** Current stored snapshots, keyed by opportunity key. */
  loadSnapshots(keys: string[]): Promise<Map<string, StoredSnapshot>>;

  upsertOpportunity(input: { runId: string; opportunity: MaterialisedOpportunity; isNew: boolean }): Promise<void>;
  writeComponents(input: { opportunityKey: string; policyVersion: string; evaluationHash: string; components: MaterialisedOpportunity['components'] }): Promise<void>;
  writeHistory(input: {
    runId: string; opportunityKey: string; eventType: string;
    fromState: unknown; toState: unknown; reason: string; policyVersion: string;
  }): Promise<void>;
  touchSeen(input: { opportunityKey: string; runId: string }): Promise<void>;

  upsertRootCause(input: { rootCauseKey: string; summary: string; memberKeys: string[]; unlockedScore: number }): Promise<void>;

  /** Reconcile against the EXISTING seo_work_items queue — no second system. */
  reconcileWorkItem(input: {
    opportunityKey: string; title: string; detail: string; priority: string;
    material: boolean; targetUrl: string | null;
  }): Promise<{ workItemId: string | null; created: boolean; updated: boolean }>;
  linkWorkItem(input: { opportunityKey: string; workItemId: string }): Promise<void>;

  /** Queries GoldPlus tracks, plus entities to cluster them against. */
  loadQueryUniverse(): Promise<{
    queries: Array<{
      raw: string; source: string; observedAt: string | null; isBackfill: boolean;
      /** seo_queries.intent — already recorded, and must not be re-derived away. */
      intent?: string | null;
      /** seo_queries.evidence_state — decides whether that intent is trusted. */
      evidenceState?: string | null;
    }>;
    entities: ClusterEntity[];
    /** Canonical route + readiness per entity, for entity-aware ownership. */
    entityRoutes?: Map<string, { url: string | null; ownerType: string | null; catalogueReady: boolean; seoEligible: boolean }>;
  }>;
  upsertCluster(input: {
    clusterKey: string; label: string; method: string; confidence: number;
    membershipSignature: string; memberCount: number; entityId: string | null; entityType: string | null;
    primaryIntent: string; secondaryIntent: string | null; intentConfidence: number; intentMethod: string;
    currentOwnerUrl: string | null; currentOwnerType: string | null;
    preferredOwnerUrl: string | null; preferredOwnerType: string | null;
    ownershipDecision: string; ownershipRationale: string;
  }): Promise<{ changed: boolean }>;
  loadClusterHashes(keys: string[]): Promise<Map<string, string>>;
  upsertQueryMembership(input: {
    membershipKey: string; clusterKey: string; rawQuery: string; normalizedQuery: string;
    method: string; confidence: number; source: string; observedAt: string | null; isBackfill: boolean;
  }): Promise<{ changed: boolean }>;
  loadMembershipKeys(clusterKeys: string[]): Promise<Set<string>>;

  /** URLs competing for the same cluster, for cannibalisation. */
  loadCompetingUrls(clusterKeys: string[]): Promise<Map<string, Array<{
    url: string; impressions: number | null; clicks: number | null; intent: Intent;
    ownerType: OwnerType | null; canonicalTarget: string | null; contentSimilarity: number | null; lifecycleActive: boolean;
    /**
     * True when a SEARCH PROVIDER reported this URL against this query, rather
     * than the URL merely containing the query text. Ownership is a claim about
     * observed reality, so only this may be believed.
     */
    providerObserved: boolean;
  }>>>;
  upsertCannibalisation(input: {
    findingKey: string; clusterKey: string | null; classification: string; confidence: number;
    rationale: string; affectedUrls: string[]; persistence: number;
  }): Promise<{ changed: boolean }>;
  loadCannibalisationHashes(keys: string[]): Promise<Map<string, string>>;

  upsertContentIntelligence(input: {
    contentKey: string; url: string; classification: string; primaryIntent: string | null;
    clusterKey: string | null; contentCompleteness: number | null; semanticHash: string;
  }): Promise<{ changed: boolean }>;
  loadContentHashes(keys: string[]): Promise<Map<string, string>>;

  upsertActionRequest(input: {
    requestKey: string; opportunityKey: string; actionClass: string; entityId: string;
    evidenceIds: string[]; policyVersion: string; preconditions: string[]; unmetPreconditions: string[];
    confidence: string; blastRadius: number; expectedEffect: string; rollbackClass: string;
    verificationPlan: string; state: string; decisionReason: string;
  }): Promise<{ changed: boolean }>;

  /**
   * Answer-unit drafts and their current grounding facts. `affectedKeys` is
   * the planner's fact-invalidation output; null means re-evaluate all.
   */
  loadAnswerUnitDrafts(affectedKeys: string[] | null): Promise<Array<AnswerUnitDraft & { templateId: string; entityContext: string }>>;

  upsertAnswerUnit(input: {
    answerKey: string; templateId: string | null; displayQuestion: string; intent: string;
    answerType: string; readiness: string; confidence: string; blockedReason: string | null;
    factRefs: unknown[]; missingFacts: string[]; unverifiedFacts: string[];
    productEntities: string[]; categoryEntities: string[]; factHash: string;
  }): Promise<{ changed: boolean }>;
  loadAnswerUnitHashes(keys: string[]): Promise<Map<string, string>>;
}

export interface RunCounts {
  entitiesEvaluated: number;
  created: number;
  updated: number;
  unchanged: number;
  closed: number;
  historyEvents: number;
  workItemsCreated: number;
  workItemsUpdated: number;
}

export interface StageOutcome {
  executed: boolean;
  count: number;
  changed: number;
  note?: string;
}

export interface MaterialisationResult {
  ran: boolean;
  runId: string | null;
  mode: MaterialisationMode;
  counts: RunCounts;
  rootCauses: number;
  answerUnitsChanged: number;
  summary: string;
  /** What the run actually did. */
  executionMode: ExecutionMode;
  /** The source boundary this result is attributable to. */
  sourceSnapshotId: string | null;
  /** Work-reduction evidence: proves the optimisation is real, or that it isn't. */
  planning: {
    sourceChanges: number;
    totalEligible: number;
    directAffected: number;
    dependentAffected: number;
    evaluated: number;
    skippedUnaffected: number;
    planMode: string;
    reasons: string[];
    coverageLimits: string[];
  } | null;
  /**
   * Per-domain execution record. A zero count is only meaningful once
   * `executed` is true — a stage that never ran must never read as "nothing
   * to do".
   */
  stages: Record<string, StageOutcome>;
}

const emptyCounts = (): RunCounts => ({
  entitiesEvaluated: 0, created: 0, updated: 0, unchanged: 0, closed: 0,
  historyEvents: 0, workItemsCreated: 0, workItemsUpdated: 0,
});

/** Only these priorities justify occupying the human work queue. */
const WORK_QUEUE_PRIORITIES = new Set(['NOW', 'NEXT']);

export class OrganicIntelligenceMaterialiser {
  constructor(
    private readonly ports: MaterialiserPorts,
    private readonly policyVersion = SCORING_POLICY_VERSION,
  ) {}

  /**
   * Evaluates one candidate into a fully-formed opportunity. Pure with respect
   * to storage — it decides WHAT is true, never whether to write it.
   */
  evaluate(c: EntityCandidate): MaterialisedOpportunity {
    const coverage = assessEvidenceCoverage(c.evidenceStates);
    const confidence = assessConfidence({
      coverage, confirmingSignals: c.confirmingSignals, persistent: c.persistent, stale: c.staleEvidence,
    });
    const commercial = assessCommercialReadiness(c.commercial);
    const seo = assessSeoReadiness(c.seoBlockers);
    const scored = scoreOpportunity({ components: c.components, coverage, confidence });
    const action = recommendedAction({
      commercialReadiness: commercial.readiness,
      seoBlocking: seo.blocking,
      contentThin: c.contentThin,
      hasOwnerPage: c.hasOwnerPage,
    });
    const priority = prioritise({
      score: scored.score, confidence, effort: c.effort, risk: c.risk,
      commercialReadiness: commercial.readiness, seoReady: seo.ready, blockedBy: [],
    });

    // The opportunity CLASS follows the recommended action, so identity tracks
    // the problem rather than the score.
    const opportunityClass = action.actionClass;
    const key = opportunityKey({ opportunityClass, entityType: c.entityType, entityId: c.entityId });

    const rc = c.templateFamily
      ? rootCauseKey({ templateFamily: c.templateFamily, actionClass: opportunityClass })
      : null;

    // Source hash covers ONLY observed evidence — never run time or ordering.
    //
    // The RAW observation is part of that evidence, not just its normalised
    // projection. Hashing only `normalized` meant any movement that landed in
    // the same normalised value was invisible: with a saturating scale,
    // observed impressions could go from 80,000 to 5,000,000 while the stored
    // record kept the old figure forever, because nothing appeared to change.
    // Raw values are banded upstream, so daily provider noise still cannot
    // move this hash.
    const src = sourceHash({
      components: c.components.map((x) => ({ c: x.component, n: x.normalized, s: x.state, r: x.raw ?? null })),
      commercial: c.commercial,
      blockers: c.seoBlockers,
      contentThin: c.contentThin,
      hasOwnerPage: c.hasOwnerPage,
    });
    const sem = semanticHash({
      class: opportunityClass,
      commercialReadiness: commercial.readiness,
      seoReady: seo.ready,
      blocking: seo.blocking,
      action: action.actionClass,
      priority: priority.bucket,
    });
    const evalHash = evaluationHash({
      policyVersion: this.policyVersion, engineVersion: ENGINE_VERSION,
      score: scored.score, components: scored.components.map((x) => [x.component, x.contribution]),
    });

    return {
      opportunityKey: key,
      opportunityClass,
      entityType: c.entityType,
      entityId: c.entityId,
      entityLabel: c.entityLabel ?? null,
      rootCauseKey: rc,
      policyVersion: this.policyVersion,
      engineVersion: ENGINE_VERSION,
      materialisationVersion: MATERIALISATION_VERSION,
      sourceHash: src,
      semanticHash: sem,
      evaluationHash: evalHash,
      score: scored.score,
      adjustedScore: priority.adjustedScore,
      unscoredWeightShare: scored.unscoredWeightShare,
      commercialReadiness: commercial.readiness,
      seoReady: seo.ready,
      contentReady: !c.contentThin,
      seoBlockers: c.seoBlockers,
      confidence,
      evidenceCompleteness: coverage.completeness,
      evidenceAvailable: coverage.available,
      evidenceMissing: coverage.missing,
      effort: c.effort,
      risk: c.risk,
      priorityBucket: priority.bucket,
      recommendedActionClass: action.actionClass,
      blockedBy: seo.blocking,
      status: priority.bucket === 'BLOCKED' ? 'BLOCKED' : 'OPEN',
      components: scored.components.map((x) => ({
        component: x.component, raw: x.raw, evidenceState: x.state,
        normalized: x.normalized, weight: x.weight, contribution: x.contribution, reasonCode: x.reasonCode,
      })),
      sourceObservedAt: c.sourceObservedAt ?? null,
      sourcePeriodStart: c.sourcePeriodStart ?? null,
      sourcePeriodEnd: c.sourcePeriodEnd ?? null,
      explanation: `${scored.explanation} ${action.rationale} ${priority.reasons.join(' ')}`.trim(),
    };
  }

  async execute(mode: MaterialisationMode = 'INCREMENTAL'): Promise<MaterialisationResult> {
    const started = await this.ports.startRun({
      mode, policyVersion: this.policyVersion, engineVersion: ENGINE_VERSION,
      materialisationVersion: MATERIALISATION_VERSION,
    });
    if (!started) {
      return {
        ran: false, runId: null, mode, counts: emptyCounts(), rootCauses: 0, answerUnitsChanged: 0,
        summary: 'Another materialisation holds the lease; this invocation stood down.',
        stages: {}, executionMode: 'FULL_REBUILD', sourceSnapshotId: null, planning: null,
      };
    }
    const runId = started.runId;
    const counts = emptyCounts();
    const stages: Record<string, StageOutcome> = {};

    // ── Source resolution and affected-entity planning ──────────────────────
    //
    // This is what makes incremental real. The planner decides what must be
    // evaluated; loadCandidates is then obliged to load only that.
    let executionMode: ExecutionMode = mode === 'FULL_REBUILD' ? 'FULL_REBUILD' : 'FULL_FALLBACK';
    let sourceSnapshotId: string | null = null;
    let planning: MaterialisationResult['planning'] = null;
    let affected: EntityRef[] | null = null;
    let commitCursors: (() => Promise<void>) | null = null;
    let plan: AffectedPlan | null = null;
    let answerUnitsChanged = 0;

    try {
      // Every materialisation records the source boundary it read, including a
      // full rebuild. Without that a rebuild cannot be compared against an
      // incremental run at all, and §13 parity would be permanently
      // INCONCLUSIVE — which is exactly what happened before this line.
      const resolved = await this.ports.resolveChanges();
      if (resolved) {
        sourceSnapshotId = resolved.snapshotId;
        commitCursors = resolved.commit;

        // Only an incremental run may narrow. A rebuild deliberately ignores
        // the plan and evaluates everything.
        if (mode === 'INCREMENTAL') {
          const universe = await this.ports.loadUniverse();
          plan = planAffectedEntities({
            changes: resolved.changes,
            resolver: await this.ports.dependencyResolver(),
            universe,
          });

          // Only an EXACT plan narrows the load. EXPANDED, FULL_FALLBACK and
          // GLOBAL all mean "evaluate everything", and each says so honestly
          // rather than reporting a narrowed run it did not perform.
          affected = plan.mode === 'EXACT' ? plan.evaluate : null;

          // A provider connecting for the first time makes evidence appear
          // across the whole portfolio at once, so the run is correctly
          // global — but calling it FULL_REBUILD would hide WHY it went wide.
          const providerEnrichment = resolved.changes.some((ch) => ch.source === 'PROVIDER_CONNECTED');
          executionMode =
            providerEnrichment ? 'PROVIDER_INITIAL_ENRICHMENT'
            : plan.mode === 'EXACT' ? 'INCREMENTAL_EXACT'
            : plan.mode === 'EXPANDED' ? 'INCREMENTAL_EXPANDED'
            : plan.mode === 'GLOBAL' ? 'FULL_REBUILD'
            : 'FULL_FALLBACK';

          const eff = planEfficiency(plan, universe.length);
          planning = {
            sourceChanges: resolved.changes.length,
            totalEligible: eff.totalEligible,
            directAffected: eff.directlyAffected,
            dependentAffected: eff.dependentAffected,
            // Filled in after loading: the affected list can legitimately name
            // one entity under two types (a category and its URL share the
            // "/slug" namespace), so its length is not the evaluated count.
            evaluated: 0,
            skippedUnaffected: 0,
            planMode: plan.mode,
            reasons: plan.reasons,
            coverageLimits: resolved.coverageLimits,
          };
        }
      }

      const candidates = await this.ports.loadCandidates(mode, affected);
      counts.entitiesEvaluated = candidates.length;

      // Work reduction is reported from what was actually evaluated, not from
      // what the planner nominated. Reporting the nomination count could show
      // more "evaluated" than exist, which is how an optimisation metric ends
      // up flattering itself.
      if (planning) {
        planning.evaluated = candidates.length;
        planning.skippedUnaffected = Math.max(0, planning.totalEligible - candidates.length);
      }

      const evaluated = candidates.map((c) => this.evaluate(c));
      const snapshots = await this.ports.loadSnapshots(evaluated.map((e) => e.opportunityKey));

      const symptoms: OpportunitySymptom[] = [];

      for (const opp of evaluated) {
        const prev = snapshots.get(opp.opportunityKey) ?? null;
        const verdict = classifyChange(prev, {
          sourceHash: opp.sourceHash,
          semanticHash: opp.semanticHash,
          evaluationHash: opp.evaluationHash,
          policyVersion: opp.policyVersion,
          evidenceAvailable: opp.evidenceAvailable,
          score: opp.score,
          priorityBucket: opp.priorityBucket,
        });

        if (verdict.kind === 'UNCHANGED') {
          counts.unchanged += 1;
          // Freshness only. No domain row is rewritten, no history is added.
          await this.ports.touchSeen({ opportunityKey: opp.opportunityKey, runId });
        } else {
          const isNew = verdict.kind === 'CREATED';
          await this.ports.upsertOpportunity({ runId, opportunity: opp, isNew });
          await this.ports.writeComponents({
            opportunityKey: opp.opportunityKey,
            policyVersion: opp.policyVersion,
            evaluationHash: opp.evaluationHash,
            components: opp.components,
          });
          if (isNew) counts.created += 1;
          else counts.updated += 1;

          if (verdict.historyRequired) {
            await this.ports.writeHistory({
              runId,
              opportunityKey: opp.opportunityKey,
              eventType: this.historyEvent(verdict.kind),
              fromState: prev ? { score: prev.score, priority: prev.priorityBucket, policy: prev.policyVersion } : null,
              toState: { score: opp.score, priority: opp.priorityBucket, policy: opp.policyVersion },
              reason: verdict.reason,
              policyVersion: opp.policyVersion,
            });
            counts.historyEvents += 1;
          }
        }

        symptoms.push({
          opportunityId: opp.opportunityKey,
          entity: opp.entityId,
          templateFamily: candidates.find((c) => c.entityId === opp.entityId)?.templateFamily ?? null,
          actionClass: opp.recommendedActionClass as OpportunitySymptom['actionClass'],
          reasonCodes: opp.blockedBy,
          score: opp.adjustedScore ?? 0,
        });

        // Only material, actionable opportunities occupy the human queue.
        const material = WORK_QUEUE_PRIORITIES.has(opp.priorityBucket) && opp.confidence !== 'LOW';
        const wi = await this.ports.reconcileWorkItem({
          opportunityKey: opp.opportunityKey,
          title: `${opp.recommendedActionClass}: ${opp.entityLabel ?? opp.entityId}`,
          detail: opp.explanation,
          priority: opp.priorityBucket === 'NOW' ? 'HIGH' : 'MEDIUM',
          material,
          targetUrl: opp.entityType === 'URL' ? opp.entityId : null,
        });
        if (wi.created) counts.workItemsCreated += 1;
        if (wi.updated) counts.workItemsUpdated += 1;
        if (wi.workItemId) await this.ports.linkWorkItem({ opportunityKey: opp.opportunityKey, workItemId: wi.workItemId });
      }

      // Root causes: one systemic fix rather than N disconnected tasks.
      const { groups } = consolidateRootCauses(symptoms);
      for (const g of groups) {
        // The consolidator's bucket key is an internal grouping string; the
        // PERSISTED identity must use the canonical derivation so it matches
        // what opportunities carry in root_cause_key.
        const [templateFamily, actionClass] = g.key.split('::');
        await this.ports.upsertRootCause({
          rootCauseKey: rootCauseKey({ templateFamily, actionClass }),
          summary: g.interventionSummary,
          memberKeys: g.memberIds,
          unlockedScore: g.unlockedScore,
        });
      }

      // Query intelligence: clustering, intent, ownership, cannibalisation.
      // These were built, tested and then left unwired — the whole point of
      // this stage is that they now actually run.
      const clusterKeys = await this.materialiseQueryIntelligence(runId, stages);

      // Content intelligence over the URLs the portfolio already knows about.
      await this.materialiseContent(evaluated, stages);

      // What the system WOULD do, and why it is not authorised to do it.
      await this.materialiseActionRequests(evaluated, stages);

      // Answer units re-evaluate whenever the facts under them move. A unit
      // whose grounding fact disappeared must not stay READY.
      const drafts = await this.ports.loadAnswerUnitDrafts(
        plan && plan.mode === 'EXACT' ? plan.affectedAnswerUnits : null,
      );
      answerUnitsChanged = await this.materialiseAnswerUnits(drafts);
      stages.ANSWER_UNITS = {
        executed: true,
        count: drafts.length,
        changed: answerUnitsChanged,
        note: drafts.length === 0 && plan?.mode === 'EXACT'
          ? 'No fact under any answer unit changed, so none needed re-evaluation.'
          : undefined,
      };

      await this.ports.finishRun({
        runId, status: 'COMPLETED', counts,
        evidenceState: this.evidenceSummary(candidates),
      });

      // The cursor advances ONLY here — after every stage has executed and the
      // run is committed. Advancing earlier would silently consume changes a
      // failed run never actually processed, and a replay would not see them
      // again.
      if (commitCursors) await commitCursors();

      return {
        ran: true, runId, mode, counts, rootCauses: groups.length, answerUnitsChanged,
        summary: `${this.summarise(mode, counts, groups.length)} ${clusterKeys} cluster(s) materialised.`,
        stages, executionMode, sourceSnapshotId, planning,
      };
    } catch (err: any) {
      const message = String(err?.message ?? err).slice(0, 500);
      await this.ports.finishRun({ runId, status: 'FAILED', counts, evidenceState: {}, error: message }).catch(() => undefined);
      // Deliberately NOT committing the cursor: the same ChangeSet must be
      // available to the next run.
      return {
        ran: true, runId, mode, counts, rootCauses: 0, answerUnitsChanged: 0,
        summary: `Materialisation failed and was contained: ${message}`,
        stages, executionMode, sourceSnapshotId, planning,
      };
    }
  }

  /**
   * Clusters, membership, ownership and cannibalisation.
   *
   * Returns the number of clusters materialised. The stage records
   * `executed: true` even when it produces nothing, because "the query
   * universe is empty because no provider is connected" and "we clustered and
   * found nothing" are different facts and an operator must be able to tell
   * them apart.
   */
  private async materialiseQueryIntelligence(
    runId: string,
    stages: Record<string, StageOutcome>,
  ): Promise<number> {
    const universe = await this.ports.loadQueryUniverse();
    const queries = universe.queries ?? [];

    if (queries.length === 0) {
      stages.QUERY_CLUSTERS = {
        executed: true, count: 0, changed: 0,
        note: 'No query universe is available. This is provider absence, not an absence of demand.',
      };
      stages.QUERY_MEMBERSHIP = { executed: true, count: 0, changed: 0, note: 'No queries to place.' };
      stages.CANNIBALISATION = { executed: true, count: 0, changed: 0, note: 'Cannibalisation needs query-level competition; none is observable.' };
      return 0;
    }

    const clusters = clusterQueries(queries.map((q) => ({ raw: q.raw })), universe.entities ?? []);
    const keys = clusters.map((c) => clusterKey(c.label));
    const priorHashes = await this.ports.loadClusterHashes(keys);
    const existingMembership = await this.ports.loadMembershipKeys(keys);

    let clustersChanged = 0;
    let membershipCount = 0;
    let membershipChanged = 0;
    const clusterKeysForCannibalisation: string[] = [];

    for (const cluster of clusters) {
      const key = clusterKey(cluster.label);
      clusterKeysForCannibalisation.push(key);

      // Intent evidence precedence: a query GoldPlus already classified is
      // stronger evidence than anything re-derived from the cluster label.
      const memberEvidence = cluster.members
        .map((m) => queries.find((q) => q.raw === m))
        .filter((q): q is NonNullable<typeof q> => Boolean(q?.intent) && q!.intent !== 'UNKNOWN');
      const consensus = intentConsensus(memberEvidence.map((q) => String(q.intent)));
      const intent = classifyIntent({
        raw: cluster.label,
        entityType: cluster.entityType,
        persisted: consensus.intent
          ? { intent: consensus.intent as never, evidenceState: consensus.evidenceState, observedAt: null }
          : null,
      });
      const competing = (await this.ports.loadCompetingUrls([key])).get(key) ?? [];
      // The incumbent is the live URL with the strongest observed signal; with
      // no demand evidence it is simply the only lifecycle-active candidate.
      const incumbent = competing.filter((u) => u.lifecycleActive)
        .sort((a, b) =>
          // An observed page outranks a merely plausible one, whatever the
          // numbers say; within the same class, the stronger demand wins.
          (Number(b.providerObserved) - Number(a.providerObserved)) ||
          ((b.impressions ?? -1) - (a.impressions ?? -1)))[0] ?? null;
      // Ownership derives from the entity's canonical route, not from a URL
      // that happens to contain the query text.
      const route = cluster.entityId ? universe.entityRoutes?.get(cluster.entityId) ?? null : null;
      const ownership = resolveOwnership({
        intent: intent.primary,
        currentOwnerUrl: incumbent?.url ?? null,
        currentOwnerType: incumbent?.ownerType ?? null,
        // Search Console reports which PAGE it served for which QUERY, so where
        // that exists the incumbent is observed reality and resolveOwnership may
        // believe it. Where it does not, the join is still lexical and is
        // recorded as the weak signal it is. Until GSC data was connected
        // nothing here was observed, every owner was discarded as untrusted,
        // and the module produced no opportunities at all.
        currentOwnerEvidence: incumbent
          ? (incumbent.providerObserved ? 'PROVIDER_OBSERVED' : 'URL_LEXICAL_FALLBACK')
          : 'NONE',
        entityCanonicalUrl: route?.url ?? null,
        entityOwnerType: (route?.ownerType ?? null) as never,
        catalogueReady: route ? route.catalogueReady : undefined,
        seoEligible: route ? route.seoEligible : undefined,
        candidateUrl: competing.find((u) => u.url !== incumbent?.url)?.url ?? null,
        contentThin: false,
        hasCommercialDepth: Boolean(route?.catalogueReady) || competing.length > 0,
        // Demand is only "known" when a provider actually reported it.
        demandKnown: competing.some((u) => u.impressions !== null),
      });

      // The membership signature is what makes "the same cluster" stable
      // across runs even as confidence numbers drift.
      const membershipSignature = semanticHash({
        members: [...cluster.members].sort(),
        method: cluster.method,
        intent: intent.primary,
        owner: ownership.preferredOwnerUrl,
        ownerDecision: ownership.decision,
      });

      const changed = priorHashes.get(key) !== membershipSignature;
      if (changed) {
        const res = await this.ports.upsertCluster({
          clusterKey: key,
          label: cluster.label,
          method: cluster.method,
          confidence: cluster.confidence,
          membershipSignature,
          memberCount: cluster.members.length,
          entityId: cluster.entityId ?? null,
          entityType: cluster.entityType ?? null,
          primaryIntent: intent.primary,
          secondaryIntent: intent.secondary ?? null,
          intentConfidence: intent.confidence,
          intentMethod: intent.method,
          // Only trusted evidence may claim current ownership; a lexical URL
          // match is discarded here rather than persisted as fact.
          currentOwnerUrl: ownership.currentOwnerUrl,
          currentOwnerType: ownership.currentOwnerUrl ? (incumbent?.ownerType ?? null) : null,
          preferredOwnerUrl: ownership.preferredOwnerUrl ?? null,
          preferredOwnerType: ownership.preferredOwnerType,
          ownershipDecision: ownership.decision,
          ownershipRationale: `${ownership.rationale} ${ownership.preferredOwnerReason}`.trim(),
        });
        if (res.changed) clustersChanged += 1;
      }

      for (const member of cluster.members) {
        const normalized = member.trim().toLowerCase();
        const membershipKey = `${key}::${semanticHash({ q: normalized })}`;
        membershipCount += 1;
        if (existingMembership.has(membershipKey)) continue;
        const provenance = queries.find((q) => q.raw === member);
        const res = await this.ports.upsertQueryMembership({
          membershipKey,
          clusterKey: key,
          rawQuery: member,
          normalizedQuery: normalized,
          method: cluster.method,
          confidence: cluster.confidence,
          source: provenance?.source ?? 'DERIVED',
          observedAt: provenance?.observedAt ?? null,
          isBackfill: provenance?.isBackfill ?? false,
        });
        if (res.changed) membershipChanged += 1;
      }
    }

    // Cannibalisation is a cluster-level judgement, so it runs once the
    // clusters exist rather than guessing from URLs alone.
    const competitionByCluster = await this.ports.loadCompetingUrls(clusterKeysForCannibalisation);
    const findingKeys: string[] = [];
    const findings: Array<{ key: string; body: Parameters<MaterialiserPorts['upsertCannibalisation']>[0] }> = [];

    for (const [ck, urls] of competitionByCluster) {
      if (urls.length < 2) continue; // One URL cannot cannibalise itself.
      const verdict = classifyCannibalisation({
        urls: urls.map((u) => ({
          url: u.url, intent: u.intent, impressions: u.impressions, clicks: u.clicks,
          ownerType: u.ownerType, canonicalTarget: u.canonicalTarget,
          contentSimilarity: u.contentSimilarity, lifecycleActive: u.lifecycleActive,
        })),
        persistence: 1,
      });
      const findingKey = `${ck}::${verdict.classification}`;
      findingKeys.push(findingKey);
      findings.push({
        key: findingKey,
        body: {
          findingKey, clusterKey: ck, classification: verdict.classification,
          confidence: verdict.confidence, rationale: verdict.rationale,
          affectedUrls: urls.map((u) => u.url), persistence: 1,
        },
      });
    }

    const priorFindings = await this.ports.loadCannibalisationHashes(findingKeys);
    let cannibalisationChanged = 0;
    for (const f of findings) {
      const h = semanticHash(f.body);
      if (priorFindings.get(f.key) === h) continue;
      const res = await this.ports.upsertCannibalisation(f.body);
      if (res.changed) cannibalisationChanged += 1;
    }

    stages.QUERY_CLUSTERS = { executed: true, count: clusters.length, changed: clustersChanged };
    stages.QUERY_MEMBERSHIP = { executed: true, count: membershipCount, changed: membershipChanged };
    stages.PAGE_OWNERSHIP = {
      executed: true, count: clusters.length, changed: clustersChanged,
      note: 'Ownership is stored on the cluster; it obeys canonical and lifecycle truth rather than raw traffic.',
    };
    stages.CANNIBALISATION = { executed: true, count: findings.length, changed: cannibalisationChanged };
    return clusters.length;
  }

  /** Content intelligence over URLs the portfolio already reasons about. */
  private async materialiseContent(
    evaluated: MaterialisedOpportunity[],
    stages: Record<string, StageOutcome>,
  ): Promise<void> {
    const urls = evaluated.filter((o) => o.entityType === 'URL');
    if (urls.length === 0) {
      stages.CONTENT_INTELLIGENCE = {
        executed: true, count: 0, changed: 0,
        note: 'No URL-scoped opportunities exist yet, so there is nothing to classify.',
      };
      return;
    }

    const keys = urls.map((o) => `content::${o.entityId}`);
    const prior = await this.ports.loadContentHashes(keys);
    let changed = 0;

    for (const o of urls) {
      const contentKey = `content::${o.entityId}`;
      // Without content signals the honest classification is
      // INSUFFICIENT_EVIDENCE — never THIN, which is a measurement.
      const classification = o.evidenceAvailable.includes('CONTENT_DEPTH')
        ? o.recommendedActionClass === 'CREATE_CONTENT' ? 'MISSING' : 'PERFORMING'
        : 'INSUFFICIENT_EVIDENCE';
      const body = {
        contentKey,
        url: o.entityId,
        classification,
        primaryIntent: null,
        clusterKey: null,
        contentCompleteness: null,
        semanticHash: semanticHash({ classification, url: o.entityId }),
      };
      if (prior.get(contentKey) === body.semanticHash) continue;
      const res = await this.ports.upsertContentIntelligence(body);
      if (res.changed) changed += 1;
    }

    stages.CONTENT_INTELLIGENCE = { executed: true, count: urls.length, changed };
  }

  /**
   * Action requests. Autonomy is level 0, so every request is recorded in a
   * non-executable state. Persisting them is how an operator sees what the
   * system believes it should do — and why it was not allowed to.
   */
  private async materialiseActionRequests(
    evaluated: MaterialisedOpportunity[],
    stages: Record<string, StageOutcome>,
  ): Promise<void> {
    const actionable = evaluated.filter((o) => WORK_QUEUE_PRIORITIES.has(o.priorityBucket));
    let changed = 0;

    for (const o of actionable) {
      const entry = catalogueEntry(o.recommendedActionClass as ActionClass);
      if (!entry) continue; // Not an action the catalogue recognises; nothing to request.

      // A request is only a decision if it is COMPLETE. Everything the gate
      // requires is supplied here so that a DENIED verdict means "policy said
      // no", not "we forgot a field".
      const request = {
        actionClass: o.recommendedActionClass as ActionClass,
        entityId: o.entityId,
        opportunityId: o.opportunityKey,
        evidenceIds: o.evidenceAvailable,
        policyVersion: o.policyVersion,
        preconditions: entry.requiredPreconditions,
        confidence: o.confidence as never,
        idempotencyKey: `ar::${o.opportunityKey}::${o.evaluationHash}`,
        blastRadius: entry.blastRadiusDefault,
        expectedEffect: o.explanation.slice(0, 500),
        rollbackClass: entry.reversibility,
        verificationPlan: entry.verificationMethod,
      };

      // Preconditions a blocked opportunity cannot satisfy are exactly the
      // ones already recorded as blockers — no separate truth.
      const satisfied = entry.requiredPreconditions.filter((p) => !o.blockedBy.includes(p));

      const decision = evaluateActionRequest({
        request,
        earnedLevel: 0,        // Autonomy level 0. Not configurable from here.
        satisfiedPreconditions: satisfied,
        writesEnabled: false,  // EXTERNAL_WRITES=false.
        observeOnly: true,
      });

      const unmet = entry.requiredPreconditions.filter((p) => !satisfied.includes(p));
      // ACCEPTED at level 0 still means a human decides; it is never executed
      // here, so it persists as APPROVAL_REQUIRED rather than PROPOSED.
      const state = decision.outcome === 'ACCEPTED' ? 'APPROVAL_REQUIRED' : decision.outcome;
      const reason = decision.outcome === 'ACCEPTED'
        ? 'Policy permits this class, but autonomy is level 0 and external writes are disabled, so it awaits a human decision.'
        : `${decision.code}: ${decision.reason}`;

      const res = await this.ports.upsertActionRequest({
        requestKey: request.idempotencyKey,
        opportunityKey: o.opportunityKey,
        actionClass: request.actionClass,
        entityId: o.entityId,
        evidenceIds: request.evidenceIds,
        policyVersion: request.policyVersion,
        preconditions: request.preconditions,
        unmetPreconditions: unmet,
        confidence: o.confidence,
        blastRadius: request.blastRadius,
        expectedEffect: request.expectedEffect,
        rollbackClass: request.rollbackClass,
        verificationPlan: request.verificationPlan,
        state,
        decisionReason: reason,
      });
      if (res.changed) changed += 1;
    }

    stages.ACTION_REQUESTS = {
      executed: true, count: actionable.length, changed,
      note: 'Recorded, never executed: autonomy level 0 means every request needs a human decision.',
    };
  }

  /** Answer units re-evaluate whenever their grounding facts move. */
  async materialiseAnswerUnits(drafts: Array<AnswerUnitDraft & { templateId: string; entityContext: string }>): Promise<number> {
    const units = drafts.map((d) => ({ draft: d, unit: buildAnswerUnit(d) }));
    const keys = units.map(({ draft }) => answerKey({
      templateId: draft.templateId, entityContext: draft.entityContext, answerType: draft.answerType,
    }));
    const existing = await this.ports.loadAnswerUnitHashes(keys);

    let changed = 0;
    for (let i = 0; i < units.length; i += 1) {
      const { draft, unit } = units[i];
      const key = keys[i];
      const refs = unit.verifiedFacts.map((f) => ({ key: f.key, sourceId: f.sourceId, verified: f.verified }));
      const hash = factHash(refs);
      if (existing.get(key) === hash) continue;

      const res = await this.ports.upsertAnswerUnit({
        answerKey: key,
        templateId: draft.templateId,
        displayQuestion: unit.question,
        intent: unit.intent,
        answerType: unit.answerType,
        readiness: unit.readiness,
        confidence: unit.confidence,
        blockedReason: unit.blockedReason,
        factRefs: refs,
        missingFacts: unit.missingFacts,
        unverifiedFacts: unit.unverifiedFacts,
        productEntities: unit.productEntities,
        categoryEntities: unit.categoryEntities,
        factHash: hash,
      });
      if (res.changed) changed += 1;
    }
    return changed;
  }

  private historyEvent(kind: ChangeKind): string {
    switch (kind) {
      case 'CREATED': return 'CREATED';
      case 'POLICY_REEVALUATED': return 'POLICY_REEVALUATED';
      case 'EVIDENCE_ENRICHED': return 'EVIDENCE_ENRICHED';
      case 'EVIDENCE_INVALIDATED': return 'EVIDENCE_INVALIDATED';
      case 'SEMANTIC_CHANGED': return 'READINESS_CHANGED';
      default: return 'SCORE_CHANGED';
    }
  }

  private evidenceSummary(candidates: EntityCandidate[]): Record<string, unknown> {
    const dims: Record<string, number> = {};
    for (const c of candidates) {
      for (const [dim, state] of Object.entries(c.evidenceStates)) {
        if (state === 'KNOWN' || state === 'PARTIAL') dims[dim] = (dims[dim] ?? 0) + 1;
      }
    }
    return { entities: candidates.length, availableByDimension: dims };
  }

  private summarise(mode: MaterialisationMode, c: RunCounts, rootCauses: number): string {
    if (c.created === 0 && c.updated === 0) {
      return `${mode}: ${c.entitiesEvaluated} entities evaluated, none changed. No domain write, no work item, no history.`;
    }
    return (
      `${mode}: ${c.entitiesEvaluated} evaluated · ${c.created} new · ${c.updated} updated · ` +
      `${c.unchanged} unchanged · ${c.historyEvents} history event(s) · ${rootCauses} root cause(s).`
    );
  }
}
