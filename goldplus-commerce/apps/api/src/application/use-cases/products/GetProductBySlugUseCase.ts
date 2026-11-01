import { IProductRepository } from '../../ports/IProductRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import { ProductPublicDto } from '@goldplus/shared';
import type { IUnlistedProductReader, UnlistedProductNotice } from '../../ports/IUnlistedProductReader';

export type GetProductBySlugResult =
  | { ok: true; dto: ProductPublicDto }
  | { ok: false; code: 'NOT_FOUND' }
  /** Known URL, product not for sale right now (draft or inactive) but published before: the page says so instead of a bare 404. */
  | { ok: false; code: 'NOT_LISTED'; notice: UnlistedProductNotice };

export class GetProductBySlugUseCase {
  constructor(private readonly products: IProductRepository, private readonly unlisted?: IUnlistedProductReader) {}

  async execute(slug: string): Promise<GetProductBySlugResult> {
    const trimmed = (slug ?? '').trim();
    if (!trimmed) return { ok: false, code: 'NOT_FOUND' };

    const source = await this.products.findPublicViewBySlug(trimmed);
    if (!source) {
      const notice = this.unlisted ? await this.unlisted.findUnlistedBySlug(trimmed).catch(() => null) : null;
      return notice ? { ok: false, code: 'NOT_LISTED', notice } : { ok: false, code: 'NOT_FOUND' };
    }

    const dto = toProductPublicDto(source);
    return { ok: true, dto: { ...dto, slug: trimmed } };
  }
}
