export interface PersistedProductImage {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  displayOrder: number;
  isPrimary: boolean;
}

/**
 * Focus 4: this port is LEGACY. `add` and `setPrimary` are no longer writable
 * in production (the Drizzle implementation refuses them); every gallery write
 * goes through ProductMediaUseCases. `remove` may delete only an unslotted row.
 */
export interface IProductImageRepository {
  findByProductId(productId: string): Promise<PersistedProductImage[]>;
  findProductIdForImage(imageId: string): Promise<string | null>;
  add(input: {
    productId: string;
    url: string;
    altText: string | null;
    makePrimary: boolean;
  }): Promise<PersistedProductImage>;
  remove(imageId: string): Promise<{ removedProductId: string } | null>;
  setPrimary(productId: string, imageId: string): Promise<void>;
}
