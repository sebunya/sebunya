import { describe, expect, it } from 'vitest';
import {
  assignVariant,
  isValidStatusTransition,
  validateExperiment,
  ExperimentDefinition,
  ExperimentStatus,
} from '../../apps/api/src/domain/experimentation/Experiment';
import { GetExperimentAssignmentUseCase } from '../../apps/api/src/application/use-cases/experimentation/GetExperimentAssignmentUseCase';
import {
  CreateExperimentUseCase,
  UpdateExperimentStatusUseCase,
} from '../../apps/api/src/application/use-cases/experimentation/ManageExperimentsUseCases';
import { IExperimentRepository, PersistedExperiment } from '../../apps/api/src/application/ports/IExperimentRepository';
import {
  IActivityEventRepository,
  PersistedActivityEvent,
} from '../../apps/api/src/application/ports/IActivityEventRepository';
import { ValidatedActivityEvent } from '../../apps/api/src/domain/engagement/ActivityEvent';

class InMemoryExperimentRepository implements IExperimentRepository {
  private items: PersistedExperiment[] = [];

  async create(experiment: ExperimentDefinition): Promise<PersistedExperiment> {
    const persisted: PersistedExperiment = {
      ...experiment,
      id: `exp-${this.items.length + 1}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.items.push(persisted);
    return persisted;
  }

  async findByKey(key: string): Promise<PersistedExperiment | null> {
    return this.items.find((e) => e.key === key) ?? null;
  }

  async list(): Promise<PersistedExperiment[]> {
    return [...this.items];
  }

  async updateStatus(id: string, status: ExperimentStatus): Promise<PersistedExperiment | null> {
    const item = this.items.find((e) => e.id === id);
    if (!item) return null;
    item.status = status;
    item.updatedAt = new Date();
    return item;
  }
}

class ExposureCapture implements IActivityEventRepository {
  public saved: ValidatedActivityEvent[] = [];
  async save(event: ValidatedActivityEvent): Promise<PersistedActivityEvent> {
    this.saved.push(event);
    return { ...event, id: `evt-${this.saved.length}`, createdAt: new Date() };
  }
  async countByTypeSince(): Promise<[]> {
    return [];
  }
  async findRecentByVisitor(): Promise<[]> {
    return [];
  }
}

const twoVariants = [
  { key: 'control', name: 'Control', weight: 1 },
  { key: 'variant_b', name: 'Variant B', weight: 1 },
];

describe('validateExperiment', () => {
  it('accepts a well-formed experiment and normalises the key', () => {
    const result = validateExperiment({
      key: 'Homepage-Hero',
      name: 'Homepage hero test',
      hypothesis: 'A benefit-led headline converts better',
      variants: twoVariants,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.experiment.key).toBe('homepage-hero');
      expect(result.experiment.status).toBe('DRAFT');
      expect(result.experiment.targetMetric).toBe('conversion_rate');
    }
  });

  it('rejects bad keys, single variants, duplicate keys, and bad weights', () => {
    expect(validateExperiment({ key: 'x', name: 'n', variants: twoVariants }).ok).toBe(false);
    expect(validateExperiment({ key: 'valid-key', name: 'n', variants: [twoVariants[0]] }).ok).toBe(false);
    expect(
      validateExperiment({ key: 'valid-key', name: 'n', variants: [twoVariants[0], twoVariants[0]] }).ok
    ).toBe(false);
    expect(
      validateExperiment({
        key: 'valid-key',
        name: 'n',
        variants: [twoVariants[0], { key: 'b', name: 'B', weight: 0 }],
      }).ok
    ).toBe(false);
  });
});

describe('assignVariant', () => {
  const experiment: ExperimentDefinition = {
    key: 'homepage-hero',
    name: 'Homepage hero',
    hypothesis: '',
    targetMetric: 'conversion_rate',
    status: 'RUNNING',
    variants: twoVariants,
  };

  it('is deterministic for the same visitor', () => {
    const first = assignVariant(experiment, 'visitor-abc');
    for (let i = 0; i < 20; i++) {
      expect(assignVariant(experiment, 'visitor-abc')?.key).toBe(first?.key);
    }
  });

  it('distributes visitors across all variants roughly by weight', () => {
    const counts: Record<string, number> = { control: 0, variant_b: 0 };
    for (let i = 0; i < 2000; i++) {
      const variant = assignVariant(experiment, `visitor-${i}`)!;
      counts[variant.key]++;
    }
    // 50/50 split with generous tolerance — determinism matters, not exactness.
    expect(counts.control).toBeGreaterThan(700);
    expect(counts.variant_b).toBeGreaterThan(700);
  });

  it('respects uneven weights', () => {
    const weighted: ExperimentDefinition = {
      ...experiment,
      variants: [
        { key: 'control', name: 'Control', weight: 9 },
        { key: 'variant_b', name: 'Variant B', weight: 1 },
      ],
    };
    let variantB = 0;
    for (let i = 0; i < 2000; i++) {
      if (assignVariant(weighted, `visitor-${i}`)!.key === 'variant_b') variantB++;
    }
    // Expect ~10%; assert well under a third.
    expect(variantB).toBeLessThan(600);
    expect(variantB).toBeGreaterThan(50);
  });
});

describe('experiment status transitions', () => {
  it('follows DRAFT -> RUNNING -> PAUSED/COMPLETED lifecycle', () => {
    expect(isValidStatusTransition('DRAFT', 'RUNNING')).toBe(true);
    expect(isValidStatusTransition('DRAFT', 'COMPLETED')).toBe(false);
    expect(isValidStatusTransition('RUNNING', 'PAUSED')).toBe(true);
    expect(isValidStatusTransition('PAUSED', 'RUNNING')).toBe(true);
    expect(isValidStatusTransition('COMPLETED', 'RUNNING')).toBe(false);
  });
});

describe('CreateExperimentUseCase', () => {
  it('creates then rejects a duplicate key', async () => {
    const repo = new InMemoryExperimentRepository();
    const uc = new CreateExperimentUseCase(repo);
    const first = await uc.execute({ key: 'promo-banner', name: 'Promo banner', variants: twoVariants });
    expect(first.ok).toBe(true);

    const dup = await uc.execute({ key: 'promo-banner', name: 'Again', variants: twoVariants });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('DUPLICATE_KEY');
  });
});

describe('GetExperimentAssignmentUseCase', () => {
  async function setupRunningExperiment() {
    const experiments = new InMemoryExperimentRepository();
    const events = new ExposureCapture();
    const create = new CreateExperimentUseCase(experiments);
    const created = await create.execute({ key: 'promo-banner', name: 'Promo banner', variants: twoVariants });
    if (!created.ok) throw new Error('setup failed');
    await new UpdateExperimentStatusUseCase(experiments).execute({ key: 'promo-banner', status: 'RUNNING' });
    return { experiments, events };
  }

  it('assigns a variant and records an EXPERIMENT_EXPOSURE event', async () => {
    const { experiments, events } = await setupRunningExperiment();
    const uc = new GetExperimentAssignmentUseCase(experiments, events);
    const result = await uc.execute({ experimentKey: 'promo-banner', visitorId: 'visitor-1' });
    expect(result.ok).toBe(true);
    expect(events.saved).toHaveLength(1);
    expect(events.saved[0].eventType).toBe('EXPERIMENT_EXPOSURE');
    expect(events.saved[0].entityId).toBe('promo-banner');
  });

  it('refuses experiments that are not RUNNING', async () => {
    const experiments = new InMemoryExperimentRepository();
    const events = new ExposureCapture();
    const create = new CreateExperimentUseCase(experiments);
    await create.execute({ key: 'still-draft', name: 'Draft', variants: twoVariants });

    const uc = new GetExperimentAssignmentUseCase(experiments, events);
    const result = await uc.execute({ experimentKey: 'still-draft', visitorId: 'v1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_RUNNING');
    expect(events.saved).toHaveLength(0);
  });

  it('returns NOT_FOUND for unknown experiments', async () => {
    const uc = new GetExperimentAssignmentUseCase(new InMemoryExperimentRepository(), new ExposureCapture());
    const result = await uc.execute({ experimentKey: 'nope', visitorId: 'v1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

describe('UpdateExperimentStatusUseCase', () => {
  it('rejects invalid transitions', async () => {
    const repo = new InMemoryExperimentRepository();
    const create = new CreateExperimentUseCase(repo);
    await create.execute({ key: 'promo-banner', name: 'Promo', variants: twoVariants });

    const uc = new UpdateExperimentStatusUseCase(repo);
    const bad = await uc.execute({ key: 'promo-banner', status: 'COMPLETED' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('BAD_TRANSITION');

    const good = await uc.execute({ key: 'promo-banner', status: 'RUNNING' });
    expect(good.ok).toBe(true);
  });
});
