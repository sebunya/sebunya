import type { IRecommendationAnalyticsRepository } from "../ports/IRecommendationAnalyticsRepository";
import type { IProductRecommendationReader } from "../ports/IProductRecommendationReader";
import type { ExperimentRecord, IExperimentRepository } from "../ports/IExperimentRepository";

/**
 * The model-readiness decision, made explicit (R8, 2026-08-06; §23, AC39/AC40).
 *
 * The ranking stage is DETERMINISTIC_POLICY and stays there until the
 * EVIDENCE gates below are met — each gate is an engineering threshold with
 * its actual value beside it, so "why no ML?" always has a numeric answer.
 * The thresholds are deliberately conservative engineering gates, not
 * statistical claims: below them a learned ranker would be trained on noise
 * and evaluated on hope.
 */

export type ModelReadinessStage =
  | "DETERMINISTIC_POLICY"
  | "HYBRID_RULES_AND_SIGNALS"
  | "LEARNED_RANKER_SHADOW_ONLY"
  | "LEARNED_RANKER_CANARY"
  | "LEARNED_RANKER_ACTIVE";

export interface ReadinessGate {
  gate: string;
  required: number;
  actual: number;
  met: boolean;
}

/** Chi-square critical values at p=0.01 by degrees of freedom (variants − 1). */
const CHI2_CRITICAL: Record<number, number> = { 1: 6.635, 2: 9.21, 3: 11.345, 4: 13.277 };

/** Below this many assignments, an SRM verdict would be noise dressed as vigilance. */
const SRM_MIN_SAMPLE = 200;

export function computeSrm(
  variants: Array<{ key: string; weightBp: number }>,
  byVariant: Record<string, number>,
): { total: number; chiSquare: number | null; srmSuspected: boolean; note: string } {
  const total = Object.values(byVariant).reduce((a, b) => a + b, 0);
  if (total < SRM_MIN_SAMPLE) {
    return { total, chiSquare: null, srmSuspected: false, note: `Below the ${SRM_MIN_SAMPLE}-assignment minimum — no verdict.` };
  }
  let chiSquare = 0;
  for (const v of variants) {
    const expected = (total * v.weightBp) / 10_000;
    const observed = byVariant[v.key] ?? 0;
    if (expected <= 0) {
      // Assignments landing in a zero-weight variant are an outright anomaly,
      // not a term to skip.
      if (observed > 0) {
        return {
          total,
          chiSquare: null,
          srmSuspected: true,
          note: `${observed} assignment(s) landed in zero-weight variant "${v.key}" — the split is broken outright.`,
        };
      }
      continue;
    }
    chiSquare += ((observed - expected) ** 2) / expected;
  }
  const critical = CHI2_CRITICAL[Math.max(1, variants.length - 1)] ?? 13.277;
  const srmSuspected = chiSquare > critical;
  return {
    total,
    chiSquare: Math.round(chiSquare * 1000) / 1000,
    srmSuspected,
    note: srmSuspected
      ? `Assignment split deviates from configured weights beyond chance (χ²=${chiSquare.toFixed(2)} > ${critical}) — the experiment's data cannot be trusted until the cause is found.`
      : "Assignment split is consistent with the configured weights.",
  };
}

export class RecommendationModelReadinessUseCase {
  constructor(
    private readonly analytics: IRecommendationAnalyticsRepository,
    private readonly products: IProductRecommendationReader,
    private readonly experiments: IExperimentRepository,
  ) {}

  async execute(): Promise<{
    stage: ModelReadinessStage;
    policyVersion: string;
    gates: ReadinessGate[];
    blockedBy: string[];
    recommendationExperiments: Array<{
      key: string;
      status: string;
      srm: ReturnType<typeof computeSrm> | null;
    }>;
    statement: string;
  }> {
    const [lineage, serving, catalogue, allExperiments] = await Promise.all([
      this.analytics.getLineageReport(90),
      this.analytics.getServingHealth(30),
      this.products.findPublicProducts({ limit: 1000 }),
      this.experiments.list(),
    ]);

    const bestsellers = await this.products.findBestsellerProductIds({ limit: 1000 });
    const paidUnits = bestsellers.reduce((sum, b) => sum + b.unitsSold, 0);

    // R9 hostile-review fixes: the orphan gate divides by CLICKS (dividing by
    // ALL events made it a gate that could not fail — 100% broken attribution
    // still passed), and it cannot be "met" before there are enough clicks to
    // judge. The stamp rate is scoped to CLIENT producers: api-engine rows are
    // auto-stamped and token-less rows never can be, so the mixed denominator
    // measured the traffic mix, not capture quality.
    const MIN_CLICKS_FOR_ORPHAN_GATE = 100;
    const orphanRate = lineage.totalClicks > 0 ? lineage.orphanClicks / lineage.totalClicks : 0;
    const profileRate = lineage.clientContractV2 > 0 ? lineage.clientProfileStamped / lineage.clientContractV2 : 0;

    const gates: ReadinessGate[] = [
      { gate: "contract_v2_events_90d", required: 10_000, actual: lineage.contractV2, met: lineage.contractV2 >= 10_000 },
      { gate: "paid_units_all_time", required: 500, actual: paidUnits, met: paidUnits >= 500 },
      { gate: "eligible_products", required: 50, actual: catalogue.length, met: catalogue.length >= 50 },
      { gate: "serving_responses_30d", required: 1_000, actual: serving.totalResponses, met: serving.totalResponses >= 1_000 },
      {
        gate: "orphan_share_of_clicks_below_1pct",
        required: 1,
        actual: Math.round(orphanRate * 10_000) / 100,
        met: lineage.totalClicks >= MIN_CLICKS_FOR_ORPHAN_GATE && orphanRate < 0.01,
      },
      { gate: "client_profile_stamp_rate_60pct", required: 60, actual: Math.round(profileRate * 100), met: profileRate >= 0.6 },
    ];

    const blockedBy = gates.filter((g) => !g.met).map((g) => g.gate);
    // AC40: no learned model without evidence — the stage can only leave
    // DETERMINISTIC_POLICY when every gate is met, and even then only to
    // SHADOW, never straight to serving.
    const stage: ModelReadinessStage = blockedBy.length === 0 ? "LEARNED_RANKER_SHADOW_ONLY" : "DETERMINISTIC_POLICY";

    const recExperiments = allExperiments.filter((e: ExperimentRecord) => e.key.startsWith("rec_"));
    const recommendationExperiments = await Promise.all(
      recExperiments.map(async (e) => ({
        key: e.key,
        status: e.status,
        srm:
          e.status === "RUNNING" || e.status === "COMPLETED"
            ? computeSrm(
                e.variants.map((v) => ({ key: v.key, weightBp: v.weightBasisPoints })),
                (await this.experiments.counts(e.id)).byVariant,
              )
            : null,
      })),
    );

    return {
      stage,
      policyVersion: "det-v3",
      gates,
      blockedBy,
      recommendationExperiments,
      statement:
        stage === "DETERMINISTIC_POLICY"
          ? `Ranking is a versioned deterministic policy. A learned ranker is blocked by ${blockedBy.length} evidence gate(s) — the numbers are beside each gate, not a judgement call.`
          : "Every evidence gate is met. The next step is SHADOW ONLY: a learned ranker may be evaluated against logged traffic, and its output still cannot reach a customer.",
    };
  }
}
