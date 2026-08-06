import type { ExperimentOperationsUseCase } from "../use-cases/experiments/ExperimentOperationsUseCase";
import type { IExperimentRepository } from "../ports/IExperimentRepository";

/**
 * Server-side experiment assignment for recommendation serving (R8; AC42/AC53).
 *
 * Everything rides the CANONICAL experiment machinery — deterministic FNV-1a
 * bucketing, unique-indexed assignment, idempotent exposure logging. This use
 * case only decides WHICH experiment applies to serving and WHAT the subject
 * is:
 *
 * - Only experiments whose key starts with `rec_` touch serving, and only
 *   while RUNNING (activation is an explicit admin transition — never this
 *   code path).
 * - One recommendation experiment at a time: with several RUNNING, the oldest
 *   wins and the rest are ignored (overlapping assignment would confound both).
 * - The subject is the SERVER-SIDE profile id. No profile → no assignment: an
 *   unidentifiable browser cannot hold a stable variant, and a flickering
 *   variant is worse than none.
 * - Exposure is logged at assignment because assignment happens ON SERVE —
 *   the variant is only ever computed when a rail is actually being produced.
 * - The client never sees an input to this decision and cannot alter it; the
 *   variant travels only in server response meta (AC53).
 *
 * Failure never blocks serving: any error returns null.
 */
export class AssignRecommendationExperimentUseCase {
  constructor(
    private readonly experiments: IExperimentRepository,
    private readonly operations: ExperimentOperationsUseCase,
  ) {}

  async execute(profileId: string): Promise<{ experimentKey: string; variantKey: string } | null> {
    try {
      const running = (await this.experiments.list())
        .filter((e) => e.key.startsWith("rec_") && e.status === "RUNNING")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const experiment = running[0];
      if (!experiment) return null;

      const { assignment } = await this.operations.assignAndExpose({
        id: experiment.id,
        subjectKey: profileId,
        exposureKey: `${experiment.id}:${profileId}`,
      });
      return { experimentKey: experiment.key, variantKey: assignment.variantKey };
    } catch {
      return null;
    }
  }
}
