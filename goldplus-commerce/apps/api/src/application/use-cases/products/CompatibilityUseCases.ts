import { IProductRepository } from '../../ports/IProductRepository';
import { ICompatibilityMappingRepository } from '../../ports/ICompatibilityMappingRepository';
import {
  CompatibilityMapping,
  validateCompatibilityMapping,
  verdictLabel,
  CompatibilityVerdict,
} from '../../../domain/products/Compatibility';

export type MappingResult =
  | { ok: true; mapping: CompatibilityMapping }
  | { ok: false; code: string; message: string };

/** Admin: declare/replace a compatibility pair. Both products must exist publicly. */
export class UpsertCompatibilityMappingUseCase {
  constructor(
    private readonly mappings: ICompatibilityMappingRepository,
    private readonly products: IProductRepository
  ) {}

  async execute(input: Record<string, unknown>): Promise<MappingResult> {
    const validated = validateCompatibilityMapping(input);
    if (!validated.ok) return validated;
    const ids = [validated.value.productId, validated.value.targetProductId];
    const rows = await this.products.findPublicViewList({ ids, limit: 2 });
    const found = new Set(rows.map((r) => r.entity.id));
    if (!found.has(validated.value.productId) || !found.has(validated.value.targetProductId)) {
      return { ok: false, code: 'PRODUCT_NOT_PUBLIC', message: 'Both products must exist and be publicly visible.' };
    }
    const mapping = await this.mappings.upsert(validated.value);
    return { ok: true, mapping };
  }
}

export class ListCompatibilityMappingsUseCase {
  constructor(private readonly mappings: ICompatibilityMappingRepository) {}
  async execute(): Promise<CompatibilityMapping[]> {
    return this.mappings.listAll();
  }
}

export class DeleteCompatibilityMappingUseCase {
  constructor(private readonly mappings: ICompatibilityMappingRepository) {}
  async execute(id: string): Promise<{ ok: boolean }> {
    if (!id) return { ok: false };
    return { ok: await this.mappings.delete(id) };
  }
}

export interface PdpCompatibilityEntry {
  productId: string;
  name: string;
  slug: string;
  verdict: CompatibilityVerdict;
  label: string;
  note: string | null;
}

/**
 * Public PDP guidance: only admin-declared, enabled mappings whose target is
 * still publicly visible. Heuristics are never shown here — unverified pairs
 * simply do not appear (unknown is not compatible).
 */
export class GetProductCompatibilityUseCase {
  constructor(
    private readonly mappings: ICompatibilityMappingRepository,
    private readonly products: IProductRepository
  ) {}

  async execute(input: { slug: string }): Promise<PdpCompatibilityEntry[]> {
    const anchor = await this.products.findPublicViewBySlug(input.slug);
    if (!anchor) return [];
    const declared = await this.mappings.listForProduct(anchor.entity.id);
    if (declared.length === 0) return [];

    const targets = await this.products.findPublicViewList({
      ids: declared.map((m) => m.targetProductId),
      limit: declared.length,
    });
    const targetById = new Map(targets.map((t) => [t.entity.id, t]));

    return declared
      .map((m): PdpCompatibilityEntry | null => {
        const target = targetById.get(m.targetProductId);
        if (!target) return null; // unpublished/dealer-only targets never leak
        return {
          productId: target.entity.id,
          name: target.entity.name,
          slug: target.entity.slug,
          verdict: m.verdict,
          label: verdictLabel(m.verdict),
          note: m.note,
        };
      })
      .filter((e): e is PdpCompatibilityEntry => e !== null);
  }
}
