export interface StoredImageResult {
  url: string;
  physicalPath: string;
}

export interface IProductImageStorage {
  /**
   * Saves a raw buffer/stream to disk, returning the persistent path metadata.
   */
  saveProductImage(productId: string, filename: string, buffer: Buffer): Promise<StoredImageResult>;
  
  /**
   * Removes a single image from disk if DB storage fails mid-operation.
   */
  deleteProductImage(physicalPath: string): Promise<void>;
}
