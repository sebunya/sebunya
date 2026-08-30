import { ProductEntity } from '../../domain/products/ProductEntity';

export interface ProductWithPrice {
  entity: ProductEntity;
  retailPriceUgx: number | null;
  categoryName: string | null;
  images: Array<{ url: string; altText: string | null; displayOrder: number; isPrimary: boolean }>;
  attributeValues: Array<{ attributeName: string; unit: string | null; value: string; isVerified: boolean }>;
}

export interface IProductRepository {
  findPublicViewBySlug(slug: string): Promise<ProductWithPrice | null>;
  findPublicViewList(opts?: {
    limit?: number;
    offset?: number;
    search?: string;
    category?: string;
    inStock?: boolean;
    ids?: string[];
  }): Promise<ProductWithPrice[]>;
}
