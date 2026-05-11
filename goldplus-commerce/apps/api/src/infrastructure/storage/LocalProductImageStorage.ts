import * as fs from 'fs/promises';
import * as path from 'path';
import { IProductImageStorage, StoredImageResult } from '../../application/ports/IProductImageStorage';

export class LocalProductImageStorage implements IProductImageStorage {
  /**
   * @param basePublicPath Absolute path to web/public directory.
   * @param uploadsSubDir Path within public relative to root, e.g., "uploads/products"
   */
  constructor(
    private readonly basePublicPath: string,
    private readonly uploadsSubDir: string = 'uploads/products'
  ) {}

  async saveProductImage(productId: string, filename: string, buffer: Buffer): Promise<StoredImageResult> {
    // Generate distinct filesystem safe product sub-directory
    const safeProductId = productId.replace(/[^a-z0-9-_]/gi, '');
    
    // apps/web/public / uploads/products / [productId]
    const targetDir = path.join(this.basePublicPath, this.uploadsSubDir, safeProductId);
    
    // Ensure target tree exists
    await fs.mkdir(targetDir, { recursive: true });

    // Complete local write path
    const finalPath = path.join(targetDir, filename);
    
    // Write buffer to file
    await fs.writeFile(finalPath, buffer);

    // Generate public url relative path e.g., "/uploads/products/[id]/[filename]"
    const publicUrl = `/${this.uploadsSubDir}/${safeProductId}/${filename}`;

    return {
      url: publicUrl,
      physicalPath: finalPath
    };
  }

  async deleteProductImage(physicalPath: string): Promise<void> {
    try {
      // Only execute unlinks within the intended base tree context for safety
      if (physicalPath.startsWith(this.basePublicPath)) {
        await fs.unlink(physicalPath);
      }
    } catch (e) {
      console.error(`[LocalProductImageStorage] Failed to cleanup partial file ${physicalPath}:`, e);
    }
  }
}
