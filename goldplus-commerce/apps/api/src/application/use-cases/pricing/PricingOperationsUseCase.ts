import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { IPricingOperationsRepository } from '../../ports/IPricingOperationsRepository';
import { EvaluateCartPricingUseCase, EvaluateCartPricingInput } from './EvaluateCartPricingUseCase';
import { PricingGovernanceUseCase } from './PricingGovernanceUseCase';

export class PricingOperationsError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export class PricingOperationsUseCase {
  constructor(private readonly governance: PricingGovernanceUseCase, private readonly evaluator: EvaluateCartPricingUseCase, private readonly operations: IPricingOperationsRepository, private readonly audit: CreateAuditLogUseCase) {}
  overview() { return this.operations.overview(); }
  list() { return this.governance.list(); }
  async detail(id: string) { const detail = await this.operations.detail(id); if (!detail) throw new PricingOperationsError('PROMOTION_NOT_FOUND', 'Promotion was not found.'); return detail; }
  create(input: Parameters<PricingGovernanceUseCase['create']>[0]) { return this.governance.create(input); }
  createVersion(input: Parameters<PricingGovernanceUseCase['createVersion']>[0]) { return this.governance.createVersion(input); }
  transition(input: Parameters<PricingGovernanceUseCase['transition']>[0]) { return this.governance.transition(input); }
  simulate(input: EvaluateCartPricingInput) { return this.evaluator.execute({ ...input, persist: false }); }
  async associateExperiment(input: { definitionId: string; versionId: string; experimentId: string; variantKey: string; actorId: string }) {
    const result = await this.operations.associateExperiment(input);
    if (result === 'NOT_FOUND') throw new PricingOperationsError('PROMOTION_VERSION_NOT_FOUND', 'Promotion version was not found.');
    if (result === 'VERSION_IMMUTABLE') throw new PricingOperationsError('VERSION_IMMUTABLE', 'Experiment evidence can be associated only while the version is DRAFT.');
    if (result === 'EXPERIMENT_NOT_READY') throw new PricingOperationsError('EXPERIMENT_NOT_READY', 'Experiment and variant must exist in a governed ready/running/paused state.');
    if (result === 'CREATED') await this.audit.execute({ actorId: input.actorId, action: 'PRICING_EXPERIMENT_ASSOCIATED', entity: 'promotion_definition', entityId: input.definitionId, newState: { versionId: input.versionId, experimentId: input.experimentId, variantKey: input.variantKey } });
    return { duplicate: result === 'DUPLICATE' };
  }
}
