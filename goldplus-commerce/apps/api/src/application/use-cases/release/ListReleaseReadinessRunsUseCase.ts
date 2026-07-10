import { IReleaseReadinessRepository, ReleaseReadinessRun } from '../../ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../ports/release/ReleaseReadinessAccessPolicy';

export class ListReleaseReadinessRunsUseCase {
  constructor(
    private readonly repository: IReleaseReadinessRepository,
    private readonly accessPolicy: IReleaseReadinessAccessPolicy,
  ) {}

  async execute(limit: number, offset: number, adminUserId: string, adminPermissions: string[]): Promise<ReleaseReadinessRun[]> {
    if (!this.accessPolicy.canViewReleaseReadiness(adminUserId, adminPermissions)) {
      throw new Error('Unauthorized to view release readiness runs');
    }

    return this.repository.listReadinessRuns(limit, offset);
  }
}
