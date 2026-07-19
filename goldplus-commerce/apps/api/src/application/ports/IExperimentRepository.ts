import { ExperimentStatus, ExperimentVariant } from '../../domain/experiments/Experiment';

export interface ExperimentRecord {
  id: string; key: string; name: string; hypothesis: string; primaryMetric: string; status: ExperimentStatus;
  version: number; variants: ExperimentVariant[]; createdAt: Date; updatedAt: Date;
}
export interface ExperimentAssignmentRecord { experimentId: string; variantKey: string; subjectHash: string; assignedAt: Date; exposureId: string; exposureKey: string }

export interface IExperimentRepository {
  create(input: { key: string; name: string; hypothesis: string; primaryMetric: string; variants: ExperimentVariant[]; actorId: string }): Promise<ExperimentRecord>;
  list(): Promise<ExperimentRecord[]>;
  find(id: string): Promise<ExperimentRecord | null>;
  transition(id: string, expectedVersion: number, from: ExperimentStatus, to: ExperimentStatus): Promise<ExperimentRecord | null>;
  assignAndExpose(input: { experiment: ExperimentRecord; subjectHash: string; variant: ExperimentVariant; exposureKey: string; occurredAt: Date }): Promise<{ assignment: ExperimentAssignmentRecord; duplicate: boolean }>;
  counts(id: string): Promise<{ assignments: number; exposures: number; byVariant: Record<string, number> }>;
}
