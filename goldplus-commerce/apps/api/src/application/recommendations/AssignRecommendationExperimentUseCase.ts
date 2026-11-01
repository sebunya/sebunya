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
  /** The running rec_ experiment, read at most once a minute: every personalised rail request asked for ALL experiments. */
  private cached: { at: number; experiment: { id: string; key: string } | null } | null = null;
  private static readonly CACHE_MS = 60_000;

  constructor(
    private readonly experiments: IExperimentRepository,
    private readonly operations: ExperimentOperationsUseCase,
    private readonly now: () => number = Date.now,
  ) {}

  private async runningExperiment(): Promise<{ id: string; key: string } | null> {
    if (this.cached && this.now() - this.cached.at < AssignRecommendationExperimentUseCase.CACHE_MS) return this.cached.experiment;
    const running = (await this.experiments.list())
      .filter((e) => e.key.startsWith("rec_") && e.status === "RUNNING")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const experiment = running[0] ? { id: running[0].id, key: running[0].key } : null;
    this.cached = { at: this.now(), experiment };
    return experiment;
  }

  async execute(profileId: string): Promise<{ experimentKey: string; variantKey: string } | null> {
    try {
      const experiment = await this.runningExperiment();
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
