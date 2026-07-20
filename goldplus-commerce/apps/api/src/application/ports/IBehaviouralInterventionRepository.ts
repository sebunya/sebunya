import { InterventionAudience, InterventionContent, InterventionOutcome, InterventionStatus, InterventionSuppression, TargetBehaviour } from '../../domain/behavioural-interventions/BehaviouralIntervention';

export interface InterventionDefinitionRecord { id: string; key: string; status: InterventionStatus; version: number; currentVersionId: string; createdBy: string; approvedBy: string | null; createdAt: Date; updatedAt: Date; }
export interface InterventionVersionRecord { id: string; definitionId: string; versionNumber: number; name: string; targetBehaviour: TargetBehaviour; hypothesis: string; primaryMetric: string; audience: InterventionAudience; channel: 'ON_SITE'; placement: string; content: InterventionContent; suppression: InterventionSuppression; experimentId: string; experimentVariantKey: string; contentDigest: string; }
export interface InterventionExposureRecord { id: string; definitionId: string; versionId: string; experimentId: string; participantRefHash: string; deliveryKey: string; eligibilityEvidence: Record<string, unknown>; occurredAt: Date; }

export interface IBehaviouralInterventionRepository {
  findExperiment(id: string): Promise<{ id: string; status: string; hypothesis: string; primaryMetric: string; variants: Array<{ key: string; name: string; weightBasisPoints: number }> } | null>;
  create(input: { key: string; name: string; targetBehaviour: TargetBehaviour; hypothesis: string; primaryMetric: string; audience: InterventionAudience; channel: 'ON_SITE'; placement: string; content: InterventionContent; suppression: InterventionSuppression; experimentId: string; experimentVariantKey: string; contentDigest: string; actorId: string }): Promise<InterventionDefinitionRecord>;
  list(): Promise<Array<InterventionDefinitionRecord & { name: string; exposures: number; outcomes: number }>>;
  detail(id: string): Promise<{ definition: InterventionDefinitionRecord; version: InterventionVersionRecord; events: unknown[]; measurement: { exposures: number; engaged: number; dismissed: number; targetAchieved: number } } | null>;
  transition(input: { id: string; expectedVersion: number; from: InterventionStatus[]; to: InterventionStatus; actorId: string; reason: string; requireDifferentActor?: boolean; requireRunningExperiment?: boolean }): Promise<InterventionDefinitionRecord | null>;
  eligible(userId: string): Promise<Array<{ definition: InterventionDefinitionRecord; version: InterventionVersionRecord; eligibilityEvidence: Record<string, unknown> }>>;
  expose(input: { definitionId: string; versionId: string; experimentId: string; userId: string; participantRefHash: string; deliveryKey: string; eligibilityEvidence: Record<string, unknown> }): Promise<{ exposure: InterventionExposureRecord; duplicate: boolean } | null>;
  findExposureByDelivery(definitionId: string, deliveryKey: string): Promise<InterventionExposureRecord | null>;
  findExposure(id: string): Promise<InterventionExposureRecord | null>;
  recordOutcome(input: { exposureId: string; definitionId: string; participantRefHash: string; outcomeKey: string; outcome: InterventionOutcome; source: 'CUSTOMER_ACTION' | 'SERVER_MEASUREMENT'; evidence: Record<string, unknown> }): Promise<{ duplicate: boolean }>;
}
