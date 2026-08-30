import { IProductRepository } from '../../ports/IProductRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import { ProductPublicDto } from '@goldplus/shared';

export class ListPublicProductsUseCase {
  constructor(private readonly products: IProductRepository) {}

  async execute(opts: {
    limit?: number;
    offset?: number;
    search?: string;
    category?: string;
    inStock?: boolean;
    ids?: string[];
  } = {}): Promise<ProductPublicDto[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 60, 100));
    // The storefront pages through the catalogue; without an offset it could
    // only ever see the first 100 approved products, so anything past that
    // was invisible to browsing AND to search.
    const offset = Number.isFinite(opts.offset) ? Math.max(0, Math.trunc(opts.offset as number)) : undefined;
    // Clamp comparison IDs array length to 3 items for performance/safe-render bounds.
    const clampedIds = opts.ids ? opts.ids.slice(0, 3) : undefined;

    const rows = await this.products.findPublicViewList({
      limit,
      offset,
      search: opts.search,
      category: opts.category,
      inStock: opts.inStock,
      ids: clampedIds,
    });

    return rows.map((row) => toProductPublicDto(row));
  }
}
