import { logger } from '../logging/logger';
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
      logger.error({ physicalPath, err: e }, '[LocalProductImageStorage] Failed to cleanup partial file');
    }
  }

  /**
   * Wave 2B: library-asset writes on the SAME storage owner. Assets live under
   * `<base>/<relativeDir>/<filename>` and are served by the edge at the same
   * `/<relativeDir>/<filename>` URL (Caddy maps /uploads/* onto the shared media
   * volume). `relativeDir` is caller-controlled but sanitised segment-by-segment so
   * a crafted checksum/filename can never traverse out of the base tree.
   */
  async saveAsset(
    relativeDir: string,
    filename: string,
    buffer: Buffer,
  ): Promise<{ url: string; storageKey: string; physicalPath: string }> {
    const safeDir = relativeDir
      .split('/')
      .map((seg) => seg.replace(/[^a-z0-9-_]/gi, ''))
      .filter(Boolean)
      .join('/');
    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'file';
    const targetDir = path.join(this.basePublicPath, safeDir);
    await fs.mkdir(targetDir, { recursive: true });
    const physicalPath = path.join(targetDir, safeName);
    await fs.writeFile(physicalPath, buffer);
    const storageKey = `${safeDir}/${safeName}`;
    return { url: `/${storageKey}`, storageKey, physicalPath };
  }

  /** Deletes a library asset by its storage key, confined to the base tree. */
  async deleteByKey(storageKey: string): Promise<void> {
    const physicalPath = path.join(this.basePublicPath, storageKey);
    const resolved = path.resolve(physicalPath);
    if (!resolved.startsWith(path.resolve(this.basePublicPath))) return;
    try {
      await fs.unlink(resolved);
    } catch (e) {
      logger.warn({ storageKey, err: e }, '[LocalProductImageStorage] asset delete skipped');
    }
  }
}
