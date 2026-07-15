import {
  IRecommendationSurfaceConfigRepository,
  PersistedSurfaceConfig,
  SurfaceConfigVersion,
} from '../../../ports/IRecommendationAdminRepositories';
import { validateSurfaceConfigInput, AdminSurfaceConfigInput } from '../../../../domain/recommendation/AdminMerchandising';
import { RecommendationSurface } from '../../../../domain/recommendation/RecommendationTypes';

export type SurfaceConfigResult =
  | { ok: true; config: PersistedSurfaceConfig }
  | { ok: false; code: string; message: string };

const VALID_SURFACES = new Set<string>([
  'product_page_bought_together', 'product_page_also_viewed', 'product_page_similar', 'product_page_complete_the_set',
  'homepage_for_you', 'cart_cross_sell', 'checkout_last_minute', 'post_purchase_next_best_offer',
  'category_trending', 'category_bestsellers', 'search_no_results', 'recently_viewed', 'new_arrivals',
]);

export class SaveSurfaceConfigDraftUseCase {
  constructor(private readonly repo: IRecommendationSurfaceConfigRepository) {}
  async execute(input: AdminSurfaceConfigInput, updatedBy: string): Promise<SurfaceConfigResult> {
    if (!VALID_SURFACES.has(input.surface)) return { ok: false, code: 'BAD_SURFACE', message: `Unknown surface "${input.surface}".` };
    const validation = validateSurfaceConfigInput(input);
    if (!validation.ok) return validation;
    const config = await this.repo.upsertDraft(validation.value, updatedBy);
    return { ok: true, config };
  }
}

export class PublishSurfaceConfigUseCase {
  constructor(private readonly repo: IRecommendationSurfaceConfigRepository) {}
  async execute(surface: RecommendationSurface, publishedBy: string): Promise<SurfaceConfigResult> {
    const current = await this.repo.findBySurface(surface);
    if (!current) return { ok: false, code: 'NOT_FOUND', message: 'No config to publish for this surface.' };
    // Re-validate before going live — never publish a broken config.
    const validation = validateSurfaceConfigInput(current);
    if (!validation.ok) return validation;
    const config = await this.repo.publish(surface, publishedBy);
    if (!config) return { ok: false, code: 'NOT_FOUND', message: 'No config to publish.' };
    return { ok: true, config };
  }
}

export class RollbackSurfaceConfigUseCase {
  constructor(private readonly repo: IRecommendationSurfaceConfigRepository) {}
  async execute(surface: RecommendationSurface, version: number, actorId: string): Promise<SurfaceConfigResult> {
    const config = await this.repo.rollback(surface, version, actorId);
    if (!config) return { ok: false, code: 'NOT_FOUND', message: 'That surface/version was not found.' };
    return { ok: true, config };
  }
}

export class ListSurfaceConfigsUseCase {
  constructor(private readonly repo: IRecommendationSurfaceConfigRepository) {}
  execute(): Promise<PersistedSurfaceConfig[]> {
    return this.repo.list();
  }
}

export class ListSurfaceConfigVersionsUseCase {
  constructor(private readonly repo: IRecommendationSurfaceConfigRepository) {}
  execute(surface: RecommendationSurface): Promise<SurfaceConfigVersion[]> {
    return this.repo.listVersions(surface);
  }
}
