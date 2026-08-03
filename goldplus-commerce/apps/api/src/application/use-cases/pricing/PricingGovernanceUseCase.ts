import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { IPricingRepository } from '../../ports/IPricingRepository';
import { DEFAULT_PROMOTION_APPROVAL_POLICY, PromotionApprovalPolicy, PromotionStatus, PromotionVersionDraft, assertActivationWindow, canTransitionPromotion, normalizeCouponCode, requiresDistinctApprover, validatePromotionVersion } from '../../../domain/pricing/Pricing';

export class PricingGovernanceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export class PricingGovernanceUseCase {
  constructor(
    private readonly repo: IPricingRepository,
    private readonly audit: CreateAuditLogUseCase,
    private readonly approvalPolicy: PromotionApprovalPolicy = DEFAULT_PROMOTION_APPROVAL_POLICY,
  ) {}

  async create(input: { key: string; name: string; description: string; actorId: string; version: PromotionVersionDraft }) {
    if (!/^[a-z0-9_-]{2,80}$/i.test(input.key)) throw new PricingGovernanceError('INVALID_PROMOTION', 'Promotion key must be a bounded identifier.');
    if (!input.name.trim() || !input.description.trim()) throw new PricingGovernanceError('INVALID_PROMOTION', 'Name and description are required.');
    const errors = validatePromotionVersion(input.version);
    if (errors.length) throw new PricingGovernanceError('INVALID_PROMOTION', errors[0]);
    const created = await this.repo.createDefinition({ ...input, name: input.name.trim(), description: input.description.trim(), version: { ...input.version, couponCode: normalizeCouponCode(input.version.couponCode) } });
    await this.audit.execute({ actorId: input.actorId, action: 'PRICING_PROMOTION_CREATED', entity: 'promotion_definition', entityId: created.definition.id, newState: { key: created.definition.key, versionId: created.version.id, status: created.definition.status } });
    return created;
  }

  list() { return this.repo.listDefinitions(); }

  async detail(id: string) {
    const definition = await this.repo.findDefinition(id);
    if (!definition) throw new PricingGovernanceError('PROMOTION_NOT_FOUND', 'Promotion was not found.');
    const activeVersion = definition.activeVersionId ? await this.repo.findVersion(definition.activeVersionId) : null;
    return { definition, activeVersion };
  }

  async createVersion(input: { definitionId: string; expectedRevision: number; actorId: string; version: PromotionVersionDraft }) {
    const errors = validatePromotionVersion(input.version);
    if (errors.length) throw new PricingGovernanceError('INVALID_PROMOTION', errors[0]);
    const created = await this.repo.createVersion({ ...input, version: { ...input.version, couponCode: normalizeCouponCode(input.version.couponCode) } });
    if (!created) throw new PricingGovernanceError('STALE_VERSION', 'Promotion changed after it was loaded.');
    await this.audit.execute({ actorId: input.actorId, action: 'PRICING_PROMOTION_VERSION_CREATED', entity: 'promotion_definition', entityId: input.definitionId, newState: { versionId: created.id, versionNumber: created.versionNumber } });
    return created;
  }

  async transition(input: { definitionId: string; versionId: string; expectedRevision: number; to: PromotionStatus; actorId: string; reason: string; now?: Date }) {
    const version = await this.repo.findVersion(input.versionId);
    if (!version || version.definitionId !== input.definitionId) throw new PricingGovernanceError('PROMOTION_VERSION_NOT_FOUND', 'Promotion version was not found.');
    if (!canTransitionPromotion(version.status, input.to)) throw new PricingGovernanceError('INVALID_TRANSITION', `${version.status} cannot transition to ${input.to}.`);
    const now = input.now ?? new Date();
    let approvalEvidence: { thresholdApplied: PromotionApprovalPolicy; distinctApproverRequired: boolean } | null = null;
    if (input.to === 'ACTIVE') {
      try { assertActivationWindow(version.status, version.schedule, now); } catch (error) { throw new PricingGovernanceError('ACTIVATION_DENIED', error instanceof Error ? error.message : 'Activation denied.'); }
      // AC10 — a high-value promotion must be activated by an approver distinct
      // from its creator. The threshold is configuration and is recorded on the
      // activation audit, never a hidden constant.
      const distinctApproverRequired = requiresDistinctApprover(version.benefits, this.approvalPolicy);
      if (distinctApproverRequired && input.actorId === version.createdBy) {
        throw new PricingGovernanceError('APPROVER_MUST_DIFFER', 'A high-value promotion must be activated by an approver different from its creator.');
      }
      approvalEvidence = { thresholdApplied: this.approvalPolicy, distinctApproverRequired };
    }
    if (!input.reason.trim()) throw new PricingGovernanceError('REASON_REQUIRED', 'A bounded operator reason is required.');
    const result = await this.repo.transitionVersion({ ...input, from: version.status, now, reason: input.reason.trim() });
    if (!result) throw new PricingGovernanceError('STALE_VERSION', 'Promotion changed after it was loaded.');
    await this.audit.execute({ actorId: input.actorId, action: `PRICING_PROMOTION_${input.to}`, entity: 'promotion_definition', entityId: input.definitionId, previousState: { status: version.status }, newState: { status: input.to, versionId: input.versionId, reason: input.reason.trim(), ...(approvalEvidence ? { approval: approvalEvidence } : {}) } });
    return result;
  }
}
