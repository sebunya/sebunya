import { createHash } from 'crypto';
import {
  IMediaLibraryRepository,
  IMediaVariantGenerator,
  MediaAssetRecord,
} from '../../ports/IMediaLibrary';

/**
 * Media library mutations (Wave 2B DAM).
 *
 * Upload is checksum-first: identical bytes resolve to the existing asset instead of
 * a second copy, so "bulk upload the supplier folder again" is idempotent. Deletion
 * is refused while any usage row exists — the graph, not operator memory, is what
 * knows whether a file is still on a product page.
 */

export interface MediaStoragePort {
  saveAsset(relativeDir: string, filename: string, buffer: Buffer): Promise<{ url: string; storageKey: string; physicalPath: string }>;
  deleteByKey(storageKey: string): Promise<void>;
}

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']);
const MAX_BYTES = 15 * 1024 * 1024;

export type UploadOutcome =
  | { kind: 'STORED'; asset: MediaAssetRecord; deduplicated: boolean }
  | { kind: 'REJECTED'; filename: string; reason: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'EMPTY' };

export class MediaLibraryUseCase {
  constructor(
    private readonly repo: IMediaLibraryRepository,
    private readonly storage: MediaStoragePort,
    private readonly variants: IMediaVariantGenerator,
  ) {}

  async upload(args: {
    files: Array<{ filename: string; mime: string; buffer: Buffer }>;
    altText?: string | null;
    caption?: string | null;
    actorId: string | null;
  }): Promise<UploadOutcome[]> {
    const outcomes: UploadOutcome[] = [];
    for (const file of args.files) {
      if (!file.buffer || file.buffer.length === 0) {
        outcomes.push({ kind: 'REJECTED', filename: file.filename, reason: 'EMPTY' });
        continue;
      }
      if (!ALLOWED_MIME.has(file.mime)) {
        outcomes.push({ kind: 'REJECTED', filename: file.filename, reason: 'UNSUPPORTED_TYPE' });
        continue;
      }
      if (file.buffer.length > MAX_BYTES) {
        outcomes.push({ kind: 'REJECTED', filename: file.filename, reason: 'TOO_LARGE' });
        continue;
      }

      const checksum = createHash('sha256').update(file.buffer).digest('hex');
      const existing = await this.repo.findByChecksum(checksum);
      if (existing) {
        outcomes.push({ kind: 'STORED', asset: existing, deduplicated: true });
        continue;
      }

      const safeName = file.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200) || 'upload';
      const dir = `uploads/assets/${checksum.slice(0, 2)}/${checksum.slice(0, 12)}`;
      const stored = await this.storage.saveAsset(dir, safeName, file.buffer);

      const derived = await this.variants.generate({
        buffer: file.buffer,
        mime: file.mime,
        checksum,
        saveVariant: async (key, buffer) => {
          const saved = await this.storage.saveAsset(dir, key, buffer);
          return { url: saved.url, storageKey: saved.storageKey };
        },
      });

      const asset = await this.repo.create({
        filename: safeName,
        mime: file.mime,
        byteSize: file.buffer.length,
        width: derived.width,
        height: derived.height,
        checksum,
        storageKey: stored.storageKey,
        url: stored.url,
        altText: args.altText ?? null,
        caption: args.caption ?? null,
        createdBy: args.actorId,
      });
      if (derived.variants.length > 0) await this.repo.addVariants(asset.id, derived.variants);
      const complete = (await this.repo.findById(asset.id)) ?? asset;
      outcomes.push({ kind: 'STORED', asset: complete, deduplicated: false });
    }
    return outcomes;
  }

  async updateMetadata(
    id: string,
    patch: Partial<Pick<MediaAssetRecord, 'altText' | 'caption' | 'rights' | 'rightsExpiresAt' | 'focalX' | 'focalY'>>,
  ): Promise<MediaAssetRecord | null> {
    return this.repo.updateMetadata(id, patch);
  }

  async archive(id: string): Promise<MediaAssetRecord | null> {
    return this.repo.setStatus(id, 'ARCHIVED');
  }

  async restore(id: string): Promise<MediaAssetRecord | null> {
    return this.repo.setStatus(id, 'ACTIVE');
  }

  /** Refuses while usages exist; deletes DB row first, then storage best-effort. */
  async safeDelete(id: string): Promise<{ kind: 'DELETED' } | { kind: 'IN_USE'; usages: number } | { kind: 'NOT_FOUND' }> {
    const asset = await this.repo.findById(id);
    if (!asset) return { kind: 'NOT_FOUND' };
    const usages = await this.repo.usages(id);
    if (usages.length > 0) return { kind: 'IN_USE', usages: usages.length };
    await this.repo.deleteRow(id);
    await this.storage.deleteByKey(asset.storageKey);
    for (const variant of asset.variants) await this.storage.deleteByKey(variant.storageKey);
    return { kind: 'DELETED' };
  }

  /** Repair flow: make this asset the product's primary image and record the usage. */
  async assignToProduct(assetId: string, productId: string): Promise<{ productId: string; url: string } | { kind: 'NOT_FOUND' }> {
    const asset = await this.repo.findById(assetId);
    if (!asset) return { kind: 'NOT_FOUND' };
    const assigned = await this.repo.assignPrimaryProductImage(productId, asset);
    if (!assigned) return { kind: 'NOT_FOUND' };
    await this.repo.recordUsage(assetId, 'product', productId, 'primary_image');
    return assigned;
  }
}
