import { createHash } from 'node:crypto';
import { IExperimentRepository } from '../../ports/IExperimentRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { ExperimentStatus, ExperimentVariant, canTransitionExperiment, deterministicVariant, validateVariants } from '../../../domain/experiments/Experiment';

export class ExperimentOperationError extends Error { constructor(public readonly code: string, message: string) { super(message); } }

export class ExperimentOperationsUseCase {
  constructor(private readonly repo: IExperimentRepository, private readonly audit: CreateAuditLogUseCase) {}
  async create(input: { key: string; name: string; hypothesis: string; primaryMetric: string; variants: ExperimentVariant[]; actorId: string }) {
    const errors = validateVariants(input.variants);
    if (!/^[a-z0-9_-]{2,80}$/i.test(input.key)) errors.push('Experiment key must be a bounded identifier.');
    if (!input.name.trim() || !input.hypothesis.trim() || !input.primaryMetric.trim()) errors.push('Name, hypothesis and primary metric are required.');
    if (errors.length) throw new ExperimentOperationError('INVALID_EXPERIMENT', errors[0]);
    const created = await this.repo.create({ ...input, name: input.name.trim(), hypothesis: input.hypothesis.trim(), primaryMetric: input.primaryMetric.trim() });
    await this.audit.execute({ actorId: input.actorId, action: 'EXPERIMENT_CREATED', entity: 'experiment', entityId: created.id, newState: { key: created.key, status: created.status, version: created.version } });
    return created;
  }
  list() { return this.repo.list(); }
  async detail(id: string) {
    const experiment = await this.repo.find(id);
    if (!experiment) throw new ExperimentOperationError('EXPERIMENT_NOT_FOUND', 'Experiment was not found.');
    return { experiment, evidence: await this.repo.counts(id), significance: { status: 'NOT_CALCULATED', reason: 'No unsupported significance claim is produced.' } };
  }
  async transition(input: { id: string; expectedVersion: number; to: ExperimentStatus; actorId: string; reason: string }) {
    const current = await this.repo.find(input.id);
    if (!current) throw new ExperimentOperationError('EXPERIMENT_NOT_FOUND', 'Experiment was not found.');
    if (!canTransitionExperiment(current.status, input.to)) throw new ExperimentOperationError('INVALID_TRANSITION', `${current.status} cannot transition to ${input.to}.`);
    const updated = await this.repo.transition(input.id, input.expectedVersion, current.status, input.to);
    if (!updated) throw new ExperimentOperationError('STALE_VERSION', 'Experiment changed after it was loaded.');
    await this.audit.execute({ actorId: input.actorId, action: `EXPERIMENT_${input.to}`, entity: 'experiment', entityId: input.id, previousState: { status: current.status, version: current.version }, newState: { status: input.to, version: updated.version, reason: input.reason } });
    return updated;
  }
  async assignAndExpose(input: { id: string; subjectKey: string; exposureKey: string; occurredAt?: Date }) {
    const experiment = await this.repo.find(input.id);
    if (!experiment) throw new ExperimentOperationError('EXPERIMENT_NOT_FOUND', 'Experiment was not found.');
    if (experiment.status !== 'RUNNING') throw new ExperimentOperationError('EXPERIMENT_NOT_RUNNING', 'Assignment is allowed only while RUNNING.');
    const subjectHash = createHash('sha256').update(input.subjectKey).digest('hex');
    const variant = deterministicVariant(experiment.id, subjectHash, experiment.variants);
    return this.repo.assignAndExpose({ experiment, subjectHash, variant, exposureKey: input.exposureKey, occurredAt: input.occurredAt ?? new Date() });
  }
}
