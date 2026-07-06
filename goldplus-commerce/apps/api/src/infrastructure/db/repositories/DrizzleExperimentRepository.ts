import { desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { experiments } from '../schema/engagement';
import { IExperimentRepository, PersistedExperiment } from '../../../application/ports/IExperimentRepository';
import { ExperimentDefinition, ExperimentStatus, ExperimentVariant } from '../../../domain/experimentation/Experiment';

function rowToPersisted(row: typeof experiments.$inferSelect): PersistedExperiment {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    hypothesis: row.hypothesis ?? '',
    targetMetric: row.targetMetric,
    status: row.status as ExperimentStatus,
    variants: (row.variants ?? []) as ExperimentVariant[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleExperimentRepository implements IExperimentRepository {
  async create(experiment: ExperimentDefinition): Promise<PersistedExperiment> {
    const [row] = await db
      .insert(experiments)
      .values({
        key: experiment.key,
        name: experiment.name,
        hypothesis: experiment.hypothesis,
        targetMetric: experiment.targetMetric,
        status: experiment.status,
        variants: experiment.variants,
      })
      .returning();
    return rowToPersisted(row);
  }

  async findByKey(key: string): Promise<PersistedExperiment | null> {
    const row = await db.query.experiments.findFirst({ where: eq(experiments.key, key) });
    return row ? rowToPersisted(row) : null;
  }

  async list(): Promise<PersistedExperiment[]> {
    const rows = await db.query.experiments.findMany({ orderBy: [desc(experiments.createdAt)] });
    return rows.map(rowToPersisted);
  }

  async updateStatus(id: string, status: ExperimentStatus): Promise<PersistedExperiment | null> {
    const [row] = await db
      .update(experiments)
      .set({ status, updatedAt: new Date() })
      .where(eq(experiments.id, id))
      .returning();
    return row ? rowToPersisted(row) : null;
  }
}
