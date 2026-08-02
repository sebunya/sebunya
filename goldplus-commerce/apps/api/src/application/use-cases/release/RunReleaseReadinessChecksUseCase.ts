import { logger } from '../../../infrastructure/logging/logger';
import { randomUUID } from 'crypto';
import { IReleaseReadinessRepository, ReleaseReadinessGateResult } from '../../ports/release/ReleaseReadinessRepository';
import { IReleaseReadinessCheckRunner } from '../../ports/release/ReleaseReadinessCheckRunner';
import { IReleaseReadinessAccessPolicy } from '../../ports/release/ReleaseReadinessAccessPolicy';
import { IReleaseReadinessAuditRepository } from '../../ports/release/ReleaseReadinessAuditRepository';

export class RunReleaseReadinessChecksUseCase {
  constructor(
    private readonly repository: IReleaseReadinessRepository,
    private readonly checkRunner: IReleaseReadinessCheckRunner,
    private readonly accessPolicy: IReleaseReadinessAccessPolicy,
    private readonly auditRepository: IReleaseReadinessAuditRepository
  ) {}

  async execute(adminUserId: string, adminPermissions: string[]): Promise<string> {
    if (!this.accessPolicy.canRunReleaseChecks(adminUserId, adminPermissions)) {
      throw new Error('Unauthorized to run release checks');
    }

    const runId = randomUUID();
    await this.repository.createReadinessRun(runId, adminUserId);
    await this.auditRepository.recordReadinessRunStarted(adminUserId, runId);

    // Run checks asynchronously to avoid blocking
    this.runChecksAsync(runId, adminUserId).catch(err => {
      logger.error({ runId, err }, 'Failed to complete readiness run');
    });

    return runId;
  }

  private async runChecksAsync(runId: string, adminUserId: string) {
    let overallStatus = 'PASS';
    try {
      const results = await this.checkRunner.runAll();
      const gateResults: ReleaseReadinessGateResult[] = [];

      for (const [gateId, result] of Object.entries(results)) {
        gateResults.push({
          id: randomUUID(),
          runId,
          gateId,
          category: gateId.split(':')[0],
          name: gateId,
          status: result.status,
          severity: result.severity,
          evidence: result.evidence,
          source: result.source,
          recommendation: result.recommendation,
          checkedAt: new Date().toISOString()
        });

        if (result.status === 'FAIL' || result.status === 'BLOCKED') {
          overallStatus = 'FAIL';
        } else if (result.status === 'WARN' && overallStatus === 'PASS') {
          overallStatus = 'WARN';
        }
      }

      await this.repository.saveGateResults(gateResults);
      await this.repository.updateReadinessRun(runId, overallStatus);
    } catch (error) {
      logger.error({ runId, err: error }, 'Error during readiness checks');
      overallStatus = 'FAIL';
      await this.repository.updateReadinessRun(runId, overallStatus);
    } finally {
      await this.auditRepository.recordReadinessRunCompleted(adminUserId, runId, overallStatus);
    }
  }
}
