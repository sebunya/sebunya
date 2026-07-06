import { ExperimentDefinition, ExperimentStatus } from '../../domain/experimentation/Experiment';

export interface PersistedExperiment extends ExperimentDefinition {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IExperimentRepository {
  create(experiment: ExperimentDefinition): Promise<PersistedExperiment>;
  findByKey(key: string): Promise<PersistedExperiment | null>;
  list(): Promise<PersistedExperiment[]>;
  updateStatus(id: string, status: ExperimentStatus): Promise<PersistedExperiment | null>;
}
