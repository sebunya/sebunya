import { ProductQualityInput } from '../../domain/products/ProductQuality';

/** Read-only scan of product fields for data-quality scoring. */
export interface IProductQualityRepository {
  scanProducts(limit: number): Promise<ProductQualityInput[]>;
}
