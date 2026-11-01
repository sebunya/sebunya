import { ProductEntity } from '../../domain/products/ProductEntity';

export interface IProductRepository {
  findById(id: string): Promise<ProductEntity | null>;
  /**
   * Persist a product under a REAL category id.
   *
   * The id is required because `products.category_id` is NOT NULL behind a
   * non-deferrable foreign key: there is no valid row without one, and the
   * implementation used to paper over that with an all-zero placeholder that no
   * category has ever had, so every insert failed.
   */
  save(product: ProductEntity, categoryId: string): Promise<void>;
}

export interface IEventPublisher {
  publish(eventType: string, payload: any): Promise<void>;
}
