import { CompatibilityMapping, CompatibilityMappingInput } from '../../domain/products/Compatibility';

export interface ICompatibilityMappingRepository {
  listAll(limit?: number): Promise<CompatibilityMapping[]>;
  /** Enabled mappings where the product is the anchor. */
  listForProduct(productId: string): Promise<CompatibilityMapping[]>;
  /** Insert or update the (productId, targetProductId) pair. */
  upsert(input: CompatibilityMappingInput): Promise<CompatibilityMapping>;
  delete(id: string): Promise<boolean>;
}
