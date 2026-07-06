import { assignVariant } from '../../../domain/experimentation/Experiment';
import { IExperimentRepository } from '../../ports/IExperimentRepository';
import { IActivityEventRepository } from '../../ports/IActivityEventRepository';

export type ExperimentAssignmentResult =
  | { ok: true; experimentKey: string; variantKey: string; variantName: string }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_RUNNING' | 'MISSING_VISITOR'; message: string };

export class GetExperimentAssignmentUseCase {
  constructor(
    private readonly experiments: IExperimentRepository,
    private readonly events: IActivityEventRepository
  ) {}

  async execute(input: { experimentKey: string; visitorId: string; userId?: string | null }): Promise<ExperimentAssignmentResult> {
    const visitorId = (input.visitorId || '').trim();
    if (!visitorId) {
      return { ok: false, code: 'MISSING_VISITOR', message: 'visitorId is required for assignment.' };
    }

    const experiment = await this.experiments.findByKey((input.experimentKey || '').trim().toLowerCase());
    if (!experiment) {
      return { ok: false, code: 'NOT_FOUND', message: 'Experiment not found.' };
    }
    if (experiment.status !== 'RUNNING') {
      return { ok: false, code: 'NOT_RUNNING', message: `Experiment "${experiment.key}" is ${experiment.status}, not RUNNING.` };
    }

    const variant = assignVariant(experiment, visitorId);
    if (!variant) {
      return { ok: false, code: 'NOT_RUNNING', message: 'Experiment has no assignable variants.' };
    }

    // Record the exposure as a first-party activity event so experiment
    // reach and KPI impact can be measured from the same event store.
    await this.events.save({
      visitorId,
      sessionId: null,
      userId: input.userId ?? null,
      eventType: 'EXPERIMENT_EXPOSURE',
      path: null,
      entity: 'experiment',
      entityId: experiment.key,
      properties: { variant: variant.key },
    });

    return { ok: true, experimentKey: experiment.key, variantKey: variant.key, variantName: variant.name };
  }
}
