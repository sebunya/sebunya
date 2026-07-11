import { ControlledLiveCanary, ControlledLiveCanaryRepository } from '../../ports/activation/ControlledLiveCanaryRepository.js';

import { ControlledActivationDryRunRepository } from '../../ports/activation/ControlledActivationDryRunRepository.js';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';

export interface CreateCanaryInput {
  dryRunId: string;
  activationRequestId: string;
  canaryCap: number;
  destinationAllowlist: string[];
  rollbackPlan: string;
  monitoringOwner: string;
  createdByAdminId: string;
}

export class CreateControlledLiveCanaryUseCase {
  constructor(
    private canaryRepo: ControlledLiveCanaryRepository,
    private dryRunRepo: ControlledActivationDryRunRepository,
    private accessPolicy: ControlledActivationAccessPolicy
  ) {}

  async execute(input: CreateCanaryInput): Promise<ControlledLiveCanary> {
    const hasPerm = await this.accessPolicy.canRunActivationReadinessChecks(input.createdByAdminId);
    if (!hasPerm) {
      throw new Error('UNAUTHORIZED');
    }

    if (!input.canaryCap || input.canaryCap <= 0) {
      throw new Error('INVALID_CANARY_CAP');
    }

    if (!input.destinationAllowlist || input.destinationAllowlist.length === 0) {
      throw new Error('INVALID_DESTINATION_ALLOWLIST');
    }

    if (!input.rollbackPlan) {
      throw new Error('INVALID_ROLLBACK_PLAN');
    }

    if (!input.monitoringOwner) {
      throw new Error('INVALID_MONITORING_OWNER');
    }

    const dryRun = await this.dryRunRepo.getDryRun(input.dryRunId);
    if (!dryRun) {
      throw new Error('DRY_RUN_NOT_FOUND');
    }

    if (dryRun.status !== 'PASSED') {
      throw new Error('DRY_RUN_NOT_PASSED');
    }

    // Evidence pack is required (implied by dry run completion evidence ref)
    if (!dryRun.redactedEvidenceRef) {
      throw new Error('EVIDENCE_PACK_NOT_FOUND');
    }

    const id = `canary-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return this.canaryRepo.createCanary({
      id,
      dryRunId: input.dryRunId,
      activationRequestId: input.activationRequestId,
      status: 'DRAFT',
      canaryCap: input.canaryCap,
      destinationAllowlist: input.destinationAllowlist,
      rollbackPlan: input.rollbackPlan,
      monitoringOwner: input.monitoringOwner,
    });
  }
}
