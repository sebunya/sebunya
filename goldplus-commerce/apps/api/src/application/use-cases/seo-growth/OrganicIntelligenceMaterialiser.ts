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
  type CommercialInput, type SeoBlocker, type Effort, type Risk,
} from './OrganicOpportunityScoring';
import { consolidateRootCauses, type OpportunitySymptom } from './OpportunityPortfolio';
import { buildAnswerUnit, type AnswerUnitDraft } from './AnswerUnitEngine';

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

  /** Entities to evaluate. INCREMENTAL supplies only affected ones. */
  loadCandidates(mode: MaterialisationMode): Promise<EntityCandidate[]>;
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

export interface MaterialisationResult {
  ran: boolean;
  runId: string | null;
  mode: MaterialisationMode;
  counts: RunCounts;
  rootCauses: number;
  answerUnitsChanged: number;
  summary: string;
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
    const src = sourceHash({
      components: c.components.map((x) => ({ c: x.component, n: x.normalized, s: x.state })),
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
      };
    }
    const runId = started.runId;
    const counts = emptyCounts();

    try {
      const candidates = await this.ports.loadCandidates(mode);
      counts.entitiesEvaluated = candidates.length;

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

      await this.ports.finishRun({
        runId, status: 'COMPLETED', counts,
        evidenceState: this.evidenceSummary(candidates),
      });

      return {
        ran: true, runId, mode, counts, rootCauses: groups.length, answerUnitsChanged: 0,
        summary: this.summarise(mode, counts, groups.length),
      };
    } catch (err: any) {
      const message = String(err?.message ?? err).slice(0, 500);
      await this.ports.finishRun({ runId, status: 'FAILED', counts, evidenceState: {}, error: message }).catch(() => undefined);
      return {
        ran: true, runId, mode, counts, rootCauses: 0, answerUnitsChanged: 0,
        summary: `Materialisation failed and was contained: ${message}`,
      };
    }
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
