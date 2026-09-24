import { IProductRepository } from '../../ports/IProductRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import { ProductPublicDto } from '@goldplus/shared';

export type GetAdminProductViewResult =
  | { ok: true; dto: ProductPublicDto & { approvalStatus: string; active: boolean; liveOnStorefront: boolean } }
  | { ok: false; code: 'NOT_FOUND' };

/**
 * Admin product detail/editor view (2026-09-24). The admin pages used to read
 * the PUBLIC /products/:slug route, which hides anything not approved AND
 * active — so every draft, rejected or inactive product (the ones that need
 * editing) showed "Product Not Found". This reads the same shape without the
 * gate and says whether the product is live, so the page can offer "View on
 * storefront" only when it is.
 */
export class GetAdminProductViewUseCase {
  constructor(private readonly products: IProductRepository) {}

  async execute(id: string): Promise<GetAdminProductViewResult> {
    const source = await this.products.findAdminViewById((id ?? '').trim());
    if (!source) return { ok: false, code: 'NOT_FOUND' };
    const approvalStatus = source.entity.approvalStatus;
    const active = source.entity.active;
    return {
      ok: true,
      dto: { ...toProductPublicDto(source), approvalStatus, active, liveOnStorefront: approvalStatus === 'approved' && active },
    };
  }
}
