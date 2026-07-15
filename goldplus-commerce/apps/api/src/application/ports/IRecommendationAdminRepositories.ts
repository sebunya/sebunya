import {
  AdminMerchandisingRule,
  AdminCompatibilityRule,
  AdminSurfaceConfigInput,
} from '../../domain/recommendation/AdminMerchandising';
import { RecommendationSurface } from '../../domain/recommendation/RecommendationTypes';

// --- Merchandising rules ---
export interface IMerchandisingRuleRepository {
  list(): Promise<AdminMerchandisingRule[]>;
  findById(id: string): Promise<AdminMerchandisingRule | null>;
  create(input: Omit<AdminMerchandisingRule, 'id'>, createdBy: string): Promise<AdminMerchandisingRule>;
  update(id: string, patch: Partial<Omit<AdminMerchandisingRule, 'id'>>): Promise<AdminMerchandisingRule | null>;
  delete(id: string): Promise<boolean>;
  /** Enabled + in-window rules relevant to a surface (loaded by the engine). */
  listActiveForSurface(surface: RecommendationSurface, now: Date): Promise<AdminMerchandisingRule[]>;
}

// --- Compatibility rules ---
export interface ICompatibilityRuleRepository {
  list(): Promise<AdminCompatibilityRule[]>;
  findById(id: string): Promise<AdminCompatibilityRule | null>;
  create(input: Omit<AdminCompatibilityRule, 'id'>, createdBy: string): Promise<AdminCompatibilityRule>;
  update(id: string, patch: Partial<Omit<AdminCompatibilityRule, 'id'>>): Promise<AdminCompatibilityRule | null>;
  delete(id: string): Promise<boolean>;
  /** Active compatibility candidates for an anchor product/category. */
  listActiveForAnchor(input: { productId: string; categoryId: string | null; now: Date }): Promise<AdminCompatibilityRule[]>;
}

// --- Surface configs (draft/publish/rollback) ---
export interface PersistedSurfaceConfig extends AdminSurfaceConfigInput {
  id: string;
  status: 'draft' | 'published';
  version: number;
  updatedAt: Date;
}

export interface SurfaceConfigVersion {
  version: number;
  snapshot: PersistedSurfaceConfig;
  createdAt: Date;
}

export interface IRecommendationSurfaceConfigRepository {
  list(): Promise<PersistedSurfaceConfig[]>;
  findBySurface(surface: RecommendationSurface): Promise<PersistedSurfaceConfig | null>;
  /** Only published configs are read by the live engine. */
  findPublished(surface: RecommendationSurface): Promise<PersistedSurfaceConfig | null>;
  upsertDraft(input: AdminSurfaceConfigInput, updatedBy: string): Promise<PersistedSurfaceConfig>;
  publish(surface: RecommendationSurface, publishedBy: string): Promise<PersistedSurfaceConfig | null>;
  listVersions(surface: RecommendationSurface): Promise<SurfaceConfigVersion[]>;
  rollback(surface: RecommendationSurface, version: number, actorId: string): Promise<PersistedSurfaceConfig | null>;
}

// --- Recommendation events (analytics) ---
export interface RecommendationEventInput {
  eventType: 'impression' | 'click' | 'add_to_cart' | 'purchase';
  surface: string;
  recommendationId?: string | null;
  algorithmVersion?: string | null;
  productId?: string | null;
  anchorProductId?: string | null;
  rank?: number | null;
  score?: number | null;
  reasonCode?: string | null;
  experimentKey?: string | null;
  experimentVariant?: string | null;
  visitorId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
}

export interface SurfacePerformanceRow {
  surface: string;
  impressions: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
}

export interface IRecommendationEventRepository {
  record(input: RecommendationEventInput): Promise<void>;
  surfacePerformanceSince(since: Date): Promise<SurfacePerformanceRow[]>;
}
