import { randomUUID } from 'node:crypto';
import * as path from 'path';
import { IProductImageRepository, PersistedProductImage } from '../../ports/IProductImageRepository';
import { IProductImageStorage } from '../../ports/IProductImageStorage';
import { ImageFileValidator } from '../../services/ImageFileValidator';

export interface RawFilePayload {
  name: string;
  type: string;
  size: number;
  buffer: Buffer;
}

export interface UploadProductImagesInput {
  productId: string;
  files: RawFilePayload[];
  altText?: string;
  makeFirstPrimary?: boolean;
}

export class UploadProductImagesUseCase {
  constructor(
    private readonly storage: IProductImageStorage,
    private readonly repository: IProductImageRepository
  ) {}

  async execute(input: UploadProductImagesInput): Promise<PersistedProductImage[]> {
    const { productId, files } = input;

    if (!productId) throw new Error('Product ID is required.');
    if (!files || files.length === 0) throw new Error('At least one image must be selected.');
    if (files.length > 8) throw new Error('Maximum of 8 images allowed per upload.');

    // Phase 1: Validate all inputs pre-writing
    for (const file of files) {
      const error = ImageFileValidator.validate({
        filename: file.name,
        mimetype: file.type,
        size: file.size
      });
      if (error) throw new Error(error);
    }

    const writtenPhysicalPaths: string[] = [];
    const savedImages: PersistedProductImage[] = [];

    try {
      // Phase 2: Sequential write & record
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Generate safe physical name protecting original user inputs
        const safeExt = path.extname(file.name).toLowerCase();
        const safeFilename = `${randomUUID()}${safeExt}`;

        // A: Write physical storage
        const storageResult = await this.storage.saveProductImage(productId, safeFilename, file.buffer);
        writtenPhysicalPaths.push(storageResult.physicalPath);

        // Determine if this index should flag makePrimary
        const isFirst = i === 0;
        const setPrimary = isFirst && input.makeFirstPrimary === true;

        // B: Commit metadata to DB
        const dbImage = await this.repository.add({
          productId,
          url: storageResult.url,
          altText: input.altText || null,
          makePrimary: setPrimary
        });
        
        savedImages.push(dbImage);
      }

      return savedImages;

    } catch (err) {
      // Phase 3: Cleanup failure atomic states
      console.error(`[UploadProductImagesUseCase] Failure encountered. Cleaning up partially written images.`, err);
      
      // Purge from disk
      for (const physicalPath of writtenPhysicalPaths) {
        await this.storage.deleteProductImage(physicalPath).catch(() => {});
      }

      // Rethrow
      throw err;
    }
  }
}
