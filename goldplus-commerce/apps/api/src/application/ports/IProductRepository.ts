import { ProductEntity } from '../../domain/products/ProductEntity';

export interface ProductWithPrice {
  entity: ProductEntity;
  retailPriceUgx: number | null;
  /**
   * The product's own floor (Price A): the lowest price a discount may reach.
   * NULL means no floor has been set, and every surface then treats the product
   * as NOT discountable rather than as freely discountable.
   */
  floorPriceUgx?: number | null;
  categoryName: string | null;
  /** `slot` is the Focus 4 canonical position (1 = cover) or null for a legacy row; readers resolve order with `resolveGallery`. */
  images: Array<{ url: string; altText: string | null; displayOrder: number; isPrimary: boolean; slot: number | null }>;
  attributeValues: Array<{ attributeName: string; unit: string | null; value: string; isVerified: boolean }>;
  /** 0218 (Baymard P1): the staff-set variant group, when the row carries one. */
  variantGroup?: string | null;
}

export interface IProductRepository {
  findPublicViewBySlug(slug: string): Promise<ProductWithPrice | null>;
  /** Admin only: the same view without the approved/active gate (drafts, rejected, inactive). */
  findAdminViewById(id: string): Promise<ProductWithPrice | null>;
  findPublicViewList(opts?: {
    limit?: number;
    offset?: number;
    search?: string;
    /**
     * The expanded query (expandSearchQuery): every group must match, any alternative in a group will do. When
     * absent, `search` is expanded by the repository itself, so every caller gets synonyms and typo fixes.
     */
    searchGroups?: string[][];
    category?: string;
    inStock?: boolean;
    ids?: string[];
  }): Promise<ProductWithPrice[]>;
  /** Word -> count over what a search can match (approved, active products and their categories). Cached. */
  searchVocabulary?(): Promise<Map<string, number>>;
  /** 0218 (Baymard P1): the listed (approved, active) products sharing this product's variant group, itself excluded. */
  findSiblings?(productId: string): Promise<ProductWithPrice[]>;
  /** 0218 (Baymard P1): set or clear (null) a product's variant group. */
  setVariantGroup?(productId: string, group: string | null): Promise<void>;
}
