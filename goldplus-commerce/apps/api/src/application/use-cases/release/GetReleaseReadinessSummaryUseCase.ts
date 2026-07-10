import { IReleaseReadinessRepository, ReleaseReadinessSummary } from '../../ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessAccessPolicy } from '../../ports/release/ReleaseReadinessAccessPolicy';
import { IReleaseReadinessAuditRepository } from '../../ports/release/ReleaseReadinessAuditRepository';

export class GetReleaseReadinessSummaryUseCase {
  constructor(
    private readonly repository: IReleaseReadinessRepository,
    private readonly accessPolicy: IReleaseReadinessAccessPolicy,
    private readonly auditRepository: IReleaseReadinessAuditRepository
  ) {}

  async execute(adminUserId: string, adminPermissions: string[]): Promise<ReleaseReadinessSummary> {
    if (!this.accessPolicy.canViewReleaseReadiness(adminUserId, adminPermissions)) {
      throw new Error('Unauthorized to view release readiness');
    }

    await this.auditRepository.recordReadinessViewed(adminUserId);

    const latestRun = await this.repository.getLatestReadinessRun();
    if (!latestRun) {
      return { latestRun: null, gates: [], decision: null };
    }

    const gates = await this.repository.getGateResultsForRun(latestRun.id);
    const decision = await this.repository.getReleaseDecisionSummary(latestRun.id);

    return { latestRun, gates, decision };
  }
}
