import { ProductEntity } from '../../domain/products/ProductEntity';

export interface ProductWithPrice {
  entity: ProductEntity;
  /** Joined retail price from product_prices. Null if no row exists. */
  retailPriceUgx: number | null;
  /** Joined category display name. Null if the category row is missing. */
  categoryName: string | null;
}

export interface IProductRepository {
  findPublicViewBySlug(slug: string): Promise<ProductWithPrice | null>;
  findPublicViewList(opts?: { limit?: number }): Promise<ProductWithPrice[]>;
}
