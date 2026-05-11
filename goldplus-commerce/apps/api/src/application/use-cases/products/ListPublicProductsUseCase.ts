import { IProductRepository } from '../../ports/IProductRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import { ProductPublicDto } from '@goldplus/shared';

export class ListPublicProductsUseCase {
  constructor(private readonly products: IProductRepository) {}

  async execute(opts: { limit?: number } = {}): Promise<ProductPublicDto[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 60, 100));
    const rows = await this.products.findPublicViewList({ limit });
    return rows.map((row) => toProductPublicDto(row));
  }
}
