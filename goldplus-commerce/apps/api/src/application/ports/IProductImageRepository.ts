export interface PersistedProductImage {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  displayOrder: number;
  isPrimary: boolean;
}

export interface IProductImageRepository {
  findByProductId(productId: string): Promise<PersistedProductImage[]>;
  add(input: {
    productId: string;
    url: string;
    altText: string | null;
    makePrimary: boolean;
  }): Promise<PersistedProductImage>;
  remove(imageId: string): Promise<{ removedProductId: string } | null>;
  setPrimary(productId: string, imageId: string): Promise<void>;
}
