import { IBehaviouralInterventionRepository } from '../../ports/IBehaviouralInterventionRepository';
import { InterventionAudience, InterventionContent, InterventionOutcome, InterventionStatus, InterventionSuppression, TargetBehaviour, canTransitionIntervention, interventionDigest, interventionParticipantHash, validateEthicalIntervention } from '../../../domain/behavioural-interventions/BehaviouralIntervention';

export class BehaviouralInterventionError extends Error { constructor(public readonly code: string, message: string) { super(message); } }

export class BehaviouralInterventionOperationsUseCase {
  constructor(private readonly repo: IBehaviouralInterventionRepository) {}
  async create(input: { key: string; name: string; targetBehaviour: TargetBehaviour; audience: InterventionAudience; channel: 'ON_SITE'; placement: string; content: InterventionContent; suppression: InterventionSuppression; experimentId: string; experimentVariantKey: string; actorId: string }) {
    if (!/^[a-z][a-z0-9_-]{2,79}$/.test(input.key)) throw new BehaviouralInterventionError('INVALID_INTERVENTION', 'Intervention key must be a bounded identifier.');
    if (input.name.trim().length < 3 || input.name.length > 160) throw new BehaviouralInterventionError('INVALID_INTERVENTION', 'Intervention name must be bounded.');
    const errors = validateEthicalIntervention(input); if (errors.length) throw new BehaviouralInterventionError('UNETHICAL_OR_INVALID_INTERVENTION', errors[0]);
    const experiment = await this.repo.findExperiment(input.experimentId); if (!experiment || !['READY','RUNNING'].includes(experiment.status)) throw new BehaviouralInterventionError('EXPERIMENT_NOT_READY', 'A real READY or RUNNING experiment is required.');
    if (!experiment.variants.some((variant) => variant.key === input.experimentVariantKey)) throw new BehaviouralInterventionError('EXPERIMENT_VARIANT_NOT_FOUND', 'The configured treatment variant does not exist.');
    const normalized = { ...input, name: input.name.trim(), audience: { lifecycleStages: [...new Set(input.audience.lifecycleStages)].sort() }, content: { ...input.content, title: input.content.title.trim(), body: input.content.body.trim(), ctaLabel: input.content.ctaLabel.trim(), disclosure: input.content.disclosure.trim() } };
    return this.repo.create({ ...normalized, hypothesis: experiment.hypothesis, primaryMetric: experiment.primaryMetric, contentDigest: interventionDigest({ targetBehaviour: normalized.targetBehaviour, hypothesis: experiment.hypothesis, primaryMetric: experiment.primaryMetric, audience: normalized.audience, channel: normalized.channel, placement: normalized.placement, content: normalized.content, suppression: normalized.suppression, experimentId: normalized.experimentId, experimentVariantKey: normalized.experimentVariantKey }) });
  }
  list() { return this.repo.list(); }
  async detail(id: string) { const found = await this.repo.detail(id); if (!found) throw new BehaviouralInterventionError('INTERVENTION_NOT_FOUND', 'Intervention was not found.'); return found; }
  private async transition(input: { id: string; expectedVersion: number; actorId: string; reason: string; from: InterventionStatus[]; to: InterventionStatus; different?: boolean; running?: boolean }) {
    if (!input.from.some((from) => canTransitionIntervention(from, input.to))) throw new BehaviouralInterventionError('INVALID_TRANSITION', 'Intervention transition is invalid.');
    if (input.reason.trim().length < 3 || input.reason.length > 1000) throw new BehaviouralInterventionError('REASON_REQUIRED', 'A bounded reason is required.');
    const result = await this.repo.transition({ id: input.id, expectedVersion: input.expectedVersion, actorId: input.actorId, reason: input.reason.trim(), from: input.from, to: input.to, requireDifferentActor: input.different, requireRunningExperiment: input.running });
    if (!result) throw new BehaviouralInterventionError('STALE_OR_INELIGIBLE', 'Intervention changed, has an invalid state, violates four-eyes approval, or its experiment is not running.'); return result;
  }
  submit(input: { id: string; expectedVersion: number; actorId: string; reason: string }) { return this.transition({ ...input, from: ['DRAFT'], to: 'PENDING_APPROVAL' }); }
  approve(input: { id: string; expectedVersion: number; actorId: string; reason: string; decision: 'APPROVED' | 'REJECTED' }) { return this.transition({ ...input, from: ['PENDING_APPROVAL'], to: input.decision, different: true }); }
  activate(input: { id: string; expectedVersion: number; actorId: string; reason: string }) { return this.transition({ ...input, from: ['APPROVED','PAUSED'], to: 'ACTIVE', running: true }); }
  pause(input: { id: string; expectedVersion: number; actorId: string; reason: string }) { return this.transition({ ...input, from: ['ACTIVE'], to: 'PAUSED' }); }
  complete(input: { id: string; expectedVersion: number; actorId: string; reason: string }) { return this.transition({ ...input, from: ['ACTIVE','PAUSED'], to: 'COMPLETED' }); }
  eligible(userId: string) { return this.repo.eligible(userId); }
  async expose(input: { definitionId: string; userId: string; deliveryKey: string }) {
    if (!/^[A-Za-z0-9:_-]{8,160}$/.test(input.deliveryKey)) throw new BehaviouralInterventionError('INVALID_DELIVERY_KEY', 'Delivery key must be a bounded identifier.');
    const participantRefHash = interventionParticipantHash(input.userId); const existing = await this.repo.findExposureByDelivery(input.definitionId, input.deliveryKey); if (existing) { if (existing.participantRefHash !== participantRefHash) throw new BehaviouralInterventionError('SUPPRESSED', 'Delivery key belongs to another participant.'); return { exposure: existing, duplicate: true }; }
    const candidate = (await this.repo.eligible(input.userId)).find((item) => item.definition.id === input.definitionId); if (!candidate) throw new BehaviouralInterventionError('SUPPRESSED', 'Intervention is inactive, experiment-ineligible, outside the audience, lacks consent or is frequency-suppressed.');
    const result = await this.repo.expose({ definitionId: candidate.definition.id, versionId: candidate.version.id, experimentId: candidate.version.experimentId, userId: input.userId, participantRefHash, deliveryKey: input.deliveryKey, eligibilityEvidence: candidate.eligibilityEvidence }); if (!result) throw new BehaviouralInterventionError('SUPPRESSED', 'Intervention became ineligible or frequency-suppressed.'); return result;
  }
  async recordCustomerOutcome(input: { exposureId: string; userId: string; outcomeKey: string; outcome: Exclude<InterventionOutcome,'TARGET_ACHIEVED'> }) {
    if (!/^[A-Za-z0-9:_-]{8,160}$/.test(input.outcomeKey) || !['ENGAGED','DISMISSED'].includes(input.outcome)) throw new BehaviouralInterventionError('INVALID_OUTCOME', 'Customer outcome is invalid.');
    const exposure = await this.repo.findExposure(input.exposureId); const participantRefHash = interventionParticipantHash(input.userId); if (!exposure || exposure.participantRefHash !== participantRefHash) throw new BehaviouralInterventionError('EXPOSURE_NOT_FOUND', 'Intervention exposure was not found.');
    const recorded = await this.repo.recordOutcome({ exposureId: exposure.id, definitionId: exposure.definitionId, participantRefHash, outcomeKey: input.outcomeKey, outcome: input.outcome, source: 'CUSTOMER_ACTION', evidence: { source: 'authenticated_customer_action', occurredAgainstVersionId: exposure.versionId } }); const detail = await this.repo.detail(exposure.definitionId); if (!detail) throw new BehaviouralInterventionError('INTERVENTION_NOT_FOUND', 'Intervention was not found.'); return { ...recorded, ctaPath: detail.version.content.ctaPath };
  }
  async recordMeasuredTarget(input: { exposureId: string; measurementEventId: string }) {
    if (!/^[A-Za-z0-9:_-]{8,160}$/.test(input.measurementEventId)) throw new BehaviouralInterventionError('INVALID_MEASUREMENT_EVENT', 'Measurement event id is invalid.');
    const exposure = await this.repo.findExposure(input.exposureId); if (!exposure) throw new BehaviouralInterventionError('EXPOSURE_NOT_FOUND', 'Intervention exposure was not found.');
    return this.repo.recordOutcome({ exposureId: exposure.id, definitionId: exposure.definitionId, participantRefHash: exposure.participantRefHash, outcomeKey: `measurement:${input.measurementEventId}`, outcome: 'TARGET_ACHIEVED', source: 'SERVER_MEASUREMENT', evidence: { measurementEventId: input.measurementEventId, occurredAgainstVersionId: exposure.versionId } });
  }
}
