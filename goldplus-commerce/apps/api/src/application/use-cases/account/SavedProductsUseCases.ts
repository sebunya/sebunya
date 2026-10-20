import type { IWishlistRepository } from '../../ports/IWishlistRepository';
import type { IProductRepository } from '../../ports/IProductRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import type { ProductPublicDto } from '@goldplus/shared';

/**
 * "Save for later" (gap analysis #6, 2026-10-20). A signed-in customer keeps a list of products; the list shows
 * them as they are sold today (price, stock), and a product no longer listed simply drops out of the view.
 * Capped so a list never becomes a store of its own.
 */
export const SAVED_PRODUCTS_CAP = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SavedProductsUseCases {
  constructor(private readonly wishlist: IWishlistRepository, private readonly products: IProductRepository) {}

  async list(userId: string): Promise<ProductPublicDto[]> {
    const ids = await this.wishlist.list(userId, SAVED_PRODUCTS_CAP);
    if (ids.length === 0) return [];
    const rows = await this.products.findPublicViewList({ ids, limit: ids.length });
    const byId = new Map(rows.map((r) => [r.entity.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)).map((r) => toProductPublicDto(r));
  }

  async save(userId: string, productId: string): Promise<'saved' | 'invalid' | 'full'> {
    if (!UUID.test(productId)) return 'invalid';
    if (!(await this.wishlist.has(userId, productId)) && (await this.wishlist.count(userId)) >= SAVED_PRODUCTS_CAP) return 'full';
    return (await this.wishlist.add(userId, productId)) === 'added' ? 'saved' : 'invalid';
  }

  async remove(userId: string, productId: string): Promise<void> {
    if (UUID.test(productId)) await this.wishlist.remove(userId, productId);
  }

  async isSaved(userId: string, productId: string): Promise<boolean> {
    return UUID.test(productId) ? this.wishlist.has(userId, productId) : false;
  }
}
