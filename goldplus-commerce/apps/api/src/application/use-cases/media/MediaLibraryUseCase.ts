import { createHash } from 'crypto';
import {
  IMediaLibraryRepository,
  IMediaVariantGenerator,
  MediaAssetRecord,
} from '../../ports/IMediaLibrary';
import { checkImagePixelBudget, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS } from '../../../domain/media/ImageHeaderDimensions';

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
  /** Whether the bytes behind a storage key are really on disk. Optional: a storage that cannot tell answers nothing and dedupe trusts the record. */
  exists?(storageKey: string): Promise<boolean>;
}

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']);

/**
 * The MIME type the BYTES say, not the one the browser sent.
 *
 * `file.mime` is the client's claim (the multipart part's content type). An
 * upload could be any bytes at all, served back later under the image type
 * it claimed. The allow-list is enforced against the file's magic bytes.
 */
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

const EXTENSION_FOR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

/**
 * The name an upload is stored (and served) under: the client's base name,
 * character-cleaned, with the extension the BYTES earned — never the one the
 * client typed.
 *
 * The edge serves /uploads/* with a plain file server that types a response by
 * its extension. Keeping the client's extension let `promo.html` whose bytes
 * start `GIF89a` pass the magic-byte sniff and then be served as text/html on
 * the shop's own origin (stored XSS, found 2026-09-24). Forcing the extension
 * from the sniffed type makes the served type match what was checked.
 */
export function storedImageFilename(clientName: string, sniffedMime: string): string {
  const ext = EXTENSION_FOR_MIME[sniffedMime];
  if (!ext) throw new Error(`No stored extension for ${sniffedMime}`);
  const cleaned = (clientName ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
  const dot = cleaned.lastIndexOf('.');
  const base = (dot > 0 ? cleaned.slice(0, dot) : cleaned)
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, 200 - ext.length - 1) || 'upload';
  return `${base}.${ext}`;
}
const MAX_BYTES = 15 * 1024 * 1024;

export type UploadRejectReason = 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'TOO_MANY_PIXELS' | 'UNREADABLE' | 'EMPTY';

/** One plain-language sentence per refusal, shared by every upload surface so none of them shows a bare code. */
export function describeUploadRejection(reason: string): string {
  switch (reason) {
    case 'UNSUPPORTED_TYPE': return 'not a PNG, JPEG, WebP, AVIF or GIF image (checked from the file itself, not its name)';
    case 'TOO_LARGE': return `larger than ${MAX_BYTES / (1024 * 1024)} MB`;
    case 'TOO_MANY_PIXELS': return `more than ${MAX_IMAGE_PIXELS / 1_000_000} megapixels or wider/taller than ${MAX_IMAGE_EDGE.toLocaleString('en-GB')} px — resize it first`;
    case 'UNREADABLE': return 'the image size could not be read — the file is damaged or not a real image';
    case 'EMPTY': return 'the file is empty';
    default: return reason;
  }
}

export type UploadOutcome =
  | { kind: 'STORED'; asset: MediaAssetRecord; deduplicated: boolean }
  | { kind: 'REJECTED'; filename: string; reason: UploadRejectReason };

/**
 * Focus 4: every "make this the product's picture" request is a gallery write.
 * The media library does not write product_images itself any more; it hands the
 * asset to the ONE mutation service (slot 1 = cover, revision-checked, audited).
 */
export interface ProductGalleryAssignPort {
  assignAsCover(input: { productId: string; assetId: string; actorId: string }): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
}

export class MediaLibraryUseCase {
  constructor(
    private readonly repo: IMediaLibraryRepository,
    private readonly storage: MediaStoragePort,
    private readonly variants: IMediaVariantGenerator,
    private readonly gallery: ProductGalleryAssignPort,
  ) {}

  async upload(args: {
    files: Array<{ filename: string; mime: string; buffer: Buffer }>;
    altText?: string | null;
    caption?: string | null;
    actorId: string | null;
  }): Promise<UploadOutcome[]> {
    const outcomes: UploadOutcome[] = [];
    for (let file of args.files) {
      if (!file.buffer || file.buffer.length === 0) {
        outcomes.push({ kind: 'REJECTED', filename: file.filename, reason: 'EMPTY' });
        continue;
      }
      const sniffed = sniffImageMime(file.buffer);
      if (!sniffed || !ALLOWED_MIME.has(sniffed)) {
        outcomes.push({ kind: 'REJECTED', filename: file.filename, reason: 'UNSUPPORTED_TYPE' });
        continue;
      }
      // From here on the stored type is what the bytes are.
      file = { ...file, mime: sniffed };
      if (file.buffer.length > MAX_BYTES) {
        outcomes.push({ kind: 'REJECTED', filename: file.filename, reason: 'TOO_LARGE' });
        continue;
      }
      // A small file can declare a gigantic canvas (a decompression bomb). The header
      // says so before anything decodes it — here, in sharp, or in a customer's browser.
      const budget = checkImagePixelBudget(file.buffer, file.mime);
      if (!budget.ok) {
        outcomes.push({ kind: 'REJECTED', filename: file.filename, reason: budget.reason });
        continue;
      }

      const checksum = createHash('sha256').update(file.buffer).digest('hex');
      const existing = await this.repo.findByChecksum(checksum);
      if (existing) {
        // The record can outlive the file (a container that stored into its own
        // filesystem, a volume restored from before the upload). Dedupe must not
        // hand back a URL that 404s when the bytes are right here: put them back.
        if (this.storage.exists && !(await this.storage.exists(existing.storageKey))) {
          const dir = existing.storageKey.split('/').slice(0, -1).join('/');
          const name = existing.storageKey.split('/').pop() ?? existing.filename;
          await this.storage.saveAsset(dir, name, file.buffer);
          await this.variants.generate({
            buffer: file.buffer, mime: existing.mime, checksum,
            saveVariant: async (key, buffer) => { const saved = await this.storage.saveAsset(dir, key, buffer); return { url: saved.url, storageKey: saved.storageKey }; },
          });
        }
        outcomes.push({ kind: 'STORED', asset: existing, deduplicated: true });
        continue;
      }

      const safeName = storedImageFilename(file.filename, file.mime);
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

  /**
   * Refuses while usages exist, like delete: archiving never takes a photo off the
   * site (pages keep their stored addresses), so archiving one in use only hid it
   * from the library while it stayed live — and a person asking to be taken down
   * would still be on the home page.
   */
  async archive(id: string): Promise<MediaAssetRecord | { kind: 'IN_USE'; usages: number } | null> {
    const usages = await this.repo.usages(id);
    if (usages.length > 0) return { kind: 'IN_USE', usages: usages.length };
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

  /**
   * Make this asset the product's cover (slot 1). Routed through the gallery
   * mutation service, which also maintains the usage graph and the audit row.
   */
  async assignToProduct(assetId: string, productId: string, actorId: string): Promise<{ productId: string; url: string } | { kind: 'NOT_FOUND' } | { kind: 'REFUSED'; code: string; message: string }> {
    const asset = await this.repo.findById(assetId);
    if (!asset) return { kind: 'NOT_FOUND' };
    const r = await this.gallery.assignAsCover({ productId, assetId, actorId });
    if (!r.ok) return r.code === 'NOT_FOUND' ? { kind: 'NOT_FOUND' } : { kind: 'REFUSED', code: r.code, message: r.message };
    return { productId, url: asset.url };
  }
}
