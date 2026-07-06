import {
  ExperimentStatus,
  EXPERIMENT_STATUSES,
  isValidStatusTransition,
  validateExperiment,
} from '../../../domain/experimentation/Experiment';
import { IExperimentRepository, PersistedExperiment } from '../../ports/IExperimentRepository';

export type CreateExperimentResult =
  | { ok: true; experiment: PersistedExperiment }
  | { ok: false; code: 'BAD_KEY' | 'BAD_NAME' | 'BAD_VARIANTS' | 'DUPLICATE_KEY'; message: string };

export class CreateExperimentUseCase {
  constructor(private readonly experiments: IExperimentRepository) {}

  async execute(input: {
    key: string;
    name: string;
    hypothesis?: string | null;
    targetMetric?: string | null;
    variants: Array<{ key?: unknown; name?: unknown; weight?: unknown }>;
  }): Promise<CreateExperimentResult> {
    const validation = validateExperiment(input);
    if (!validation.ok) {
      return { ok: false, code: validation.code, message: validation.message };
    }

    const existing = await this.experiments.findByKey(validation.experiment.key);
    if (existing) {
      return { ok: false, code: 'DUPLICATE_KEY', message: `Experiment "${validation.experiment.key}" already exists.` };
    }

    const experiment = await this.experiments.create(validation.experiment);
    return { ok: true, experiment };
  }
}

export class ListExperimentsUseCase {
  constructor(private readonly experiments: IExperimentRepository) {}

  async execute(): Promise<PersistedExperiment[]> {
    return this.experiments.list();
  }
}

export type UpdateExperimentStatusResult =
  | { ok: true; experiment: PersistedExperiment }
  | { ok: false; code: 'NOT_FOUND' | 'BAD_STATUS' | 'BAD_TRANSITION'; message: string };

export class UpdateExperimentStatusUseCase {
  constructor(private readonly experiments: IExperimentRepository) {}

  async execute(input: { key: string; status: string }): Promise<UpdateExperimentStatusResult> {
    const status = (input.status || '').trim().toUpperCase() as ExperimentStatus;
    if (!EXPERIMENT_STATUSES.includes(status)) {
      return { ok: false, code: 'BAD_STATUS', message: `Status must be one of ${EXPERIMENT_STATUSES.join(', ')}.` };
    }

    const experiment = await this.experiments.findByKey((input.key || '').trim().toLowerCase());
    if (!experiment) {
      return { ok: false, code: 'NOT_FOUND', message: 'Experiment not found.' };
    }

    if (!isValidStatusTransition(experiment.status, status)) {
      return {
        ok: false,
        code: 'BAD_TRANSITION',
        message: `Cannot move experiment from ${experiment.status} to ${status}.`,
      };
    }

    const updated = await this.experiments.updateStatus(experiment.id, status);
    if (!updated) {
      return { ok: false, code: 'NOT_FOUND', message: 'Experiment disappeared during update.' };
    }
    return { ok: true, experiment: updated };
  }
}
