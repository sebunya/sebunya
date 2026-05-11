import { IProductRepository } from '../../ports/IProductRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import { ProductPublicDto } from '@goldplus/shared';

export type GetProductBySlugResult =
  | { ok: true; dto: ProductPublicDto }
  | { ok: false; code: 'NOT_FOUND' };

export class GetProductBySlugUseCase {
  constructor(private readonly products: IProductRepository) {}

  async execute(slug: string): Promise<GetProductBySlugResult> {
    const trimmed = (slug ?? '').trim();
    if (!trimmed) return { ok: false, code: 'NOT_FOUND' };

    const source = await this.products.findPublicViewBySlug(trimmed);
    if (!source) return { ok: false, code: 'NOT_FOUND' };

    const dto = toProductPublicDto(source);
    return { ok: true, dto: { ...dto, slug: trimmed } };
  }
}
