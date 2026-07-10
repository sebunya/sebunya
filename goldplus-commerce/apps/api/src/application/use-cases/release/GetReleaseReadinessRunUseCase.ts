import { IReleaseReadinessRepository, ReleaseReadinessRun, ReleaseReadinessGateResult } from '../../ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../ports/release/ReleaseReadinessAccessPolicy';

export class GetReleaseReadinessRunUseCase {
  constructor(
    private readonly repository: IReleaseReadinessRepository,
    private readonly accessPolicy: IReleaseReadinessAccessPolicy,
  ) {}

  async execute(runId: string, adminUserId: string, adminPermissions: string[]): Promise<{ run: ReleaseReadinessRun, gates: ReleaseReadinessGateResult[] }> {
    if (!this.accessPolicy.canViewReleaseReadiness(adminUserId, adminPermissions)) {
      throw new Error('Unauthorized to view release readiness run');
    }

    const run = await this.repository.getReadinessRunById(runId);
    if (!run) {
      throw new Error('Run not found');
    }

    const gates = await this.repository.getGateResultsForRun(runId);
    return { run, gates };
  }
}
