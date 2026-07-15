import { desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { recommendationSurfaceConfigs, recommendationConfigVersions } from '../schema/recommendations';
import {
  IRecommendationSurfaceConfigRepository,
  PersistedSurfaceConfig,
  SurfaceConfigVersion,
} from '../../../application/ports/IRecommendationAdminRepositories';
import { AdminSurfaceConfigInput } from '../../../domain/recommendation/AdminMerchandising';
import { RecommendationSurface, RecommendationSignal } from '../../../domain/recommendation/RecommendationTypes';

type Row = typeof recommendationSurfaceConfigs.$inferSelect;

function toConfig(r: Row): PersistedSurfaceConfig {
  return {
    id: r.id,
    surface: r.surface as RecommendationSurface,
    enabled: r.enabled,
    status: r.status as 'draft' | 'published',
    title: r.title,
    subtitle: r.subtitle ?? null,
    limit: r.limit,
    minItems: r.minItems,
    hideIfBelowMinItems: r.hideIfBelowMinItems,
    hideIfOnlyFallback: r.hideIfOnlyFallback,
    showReasonTags: r.showReasonTags,
    allowPageDuplicates: r.allowPageDuplicates,
    fallbackTitle: r.fallbackTitle ?? null,
    fallbackChain: (r.fallbackChain ?? []) as RecommendationSignal[],
    signalWeights: (r.signalWeights ?? {}) as Partial<Record<RecommendationSignal, number>>,
    maxPerCategory: r.maxPerCategory ?? null,
    maxPerBrand: r.maxPerBrand ?? null,
    requiresPersonalization: r.requiresPersonalization,
    version: r.version,
    updatedAt: r.updatedAt,
  };
}

function toValues(input: AdminSurfaceConfigInput) {
  return {
    surface: input.surface,
    enabled: input.enabled,
    title: input.title,
    subtitle: input.subtitle ?? null,
    limit: input.limit,
    minItems: input.minItems,
    hideIfBelowMinItems: input.hideIfBelowMinItems,
    hideIfOnlyFallback: input.hideIfOnlyFallback,
    showReasonTags: input.showReasonTags,
    allowPageDuplicates: input.allowPageDuplicates,
    fallbackTitle: input.fallbackTitle ?? null,
    fallbackChain: input.fallbackChain,
    signalWeights: input.signalWeights as Record<string, number>,
    maxPerCategory: input.maxPerCategory ?? null,
    maxPerBrand: input.maxPerBrand ?? null,
    requiresPersonalization: input.requiresPersonalization ?? false,
  };
}

export class DrizzleRecommendationSurfaceConfigRepository implements IRecommendationSurfaceConfigRepository {
  async list(): Promise<PersistedSurfaceConfig[]> {
    const rows = await db.query.recommendationSurfaceConfigs.findMany({ orderBy: [desc(recommendationSurfaceConfigs.updatedAt)] });
    return rows.map(toConfig);
  }

  async findBySurface(surface: RecommendationSurface): Promise<PersistedSurfaceConfig | null> {
    const row = await db.query.recommendationSurfaceConfigs.findFirst({ where: eq(recommendationSurfaceConfigs.surface, surface) });
    return row ? toConfig(row) : null;
  }

  async findPublished(surface: RecommendationSurface): Promise<PersistedSurfaceConfig | null> {
    const row = await db.query.recommendationSurfaceConfigs.findFirst({ where: eq(recommendationSurfaceConfigs.surface, surface) });
    if (!row || row.status !== 'published') return null;
    return toConfig(row);
  }

  async upsertDraft(input: AdminSurfaceConfigInput, updatedBy: string): Promise<PersistedSurfaceConfig> {
    const existing = await this.findBySurface(input.surface);
    if (!existing) {
      const [row] = await db
        .insert(recommendationSurfaceConfigs)
        .values({ ...toValues(input), status: 'draft', version: 1, updatedBy })
        .returning();
      return toConfig(row);
    }
    // Editing a published surface starts the next draft version.
    const nextVersion = existing.status === 'published' ? existing.version + 1 : existing.version;
    const [row] = await db
      .update(recommendationSurfaceConfigs)
      .set({ ...toValues(input), status: 'draft', version: nextVersion, updatedBy, updatedAt: new Date() })
      .where(eq(recommendationSurfaceConfigs.surface, input.surface))
      .returning();
    return toConfig(row);
  }

  async publish(surface: RecommendationSurface, publishedBy: string): Promise<PersistedSurfaceConfig | null> {
    const current = await this.findBySurface(surface);
    if (!current) return null;
    const [row] = await db
      .update(recommendationSurfaceConfigs)
      .set({ status: 'published', updatedBy: publishedBy, updatedAt: new Date() })
      .where(eq(recommendationSurfaceConfigs.surface, surface))
      .returning();
    const published = toConfig(row);
    await db.insert(recommendationConfigVersions).values({
      surface,
      version: published.version,
      snapshot: published as unknown as Record<string, unknown>,
      publishedBy,
    });
    return published;
  }

  async listVersions(surface: RecommendationSurface): Promise<SurfaceConfigVersion[]> {
    const rows = await db.query.recommendationConfigVersions.findMany({
      where: eq(recommendationConfigVersions.surface, surface),
      orderBy: [desc(recommendationConfigVersions.version)],
    });
    return rows.map((r) => ({ version: r.version, snapshot: r.snapshot as unknown as PersistedSurfaceConfig, createdAt: r.createdAt }));
  }

  async rollback(surface: RecommendationSurface, version: number, actorId: string): Promise<PersistedSurfaceConfig | null> {
    const versionRow = await db.query.recommendationConfigVersions.findFirst({
      where: (t, { and, eq }) => and(eq(t.surface, surface), eq(t.version, version)),
    });
    const current = await this.findBySurface(surface);
    if (!versionRow || !current) return null;
    const snap = versionRow.snapshot as unknown as PersistedSurfaceConfig;
    const restored: AdminSurfaceConfigInput = { ...snap };
    const nextVersion = current.version + 1;
    const [row] = await db
      .update(recommendationSurfaceConfigs)
      .set({ ...toValues(restored), status: 'published', version: nextVersion, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(recommendationSurfaceConfigs.surface, surface))
      .returning();
    const published = toConfig(row);
    await db.insert(recommendationConfigVersions).values({
      surface,
      version: nextVersion,
      snapshot: published as unknown as Record<string, unknown>,
      publishedBy: actorId,
    });
    return published;
  }
}
