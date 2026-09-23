import { ImageFileValidator } from '../../services/ImageFileValidator';
import type { GallerySlot } from '@goldplus/shared';
import { describeUploadRejection } from '../media/MediaLibraryUseCase';

/**
 * Focus 4: the listing editor's "add photos" form. Every file goes through the
 * media library (magic-byte type check, checksum dedupe, renditions) and then
 * into the product's gallery through the ONE mutation service — first file to
 * the cover when the gallery has none (or when the operator asked for it), the
 * rest into the next free slot. A fifth image is reported, never silently
 * dropped. There is no second storage path any more.
 */

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
  actorId: string;
}

export interface UploadedGalleryImage {
  assetId: string;
  url: string;
  slot: GallerySlot | null;
  deduplicated: boolean;
  outcome: 'ASSIGNED' | 'COVER' | 'ALREADY_IN_GALLERY' | 'GALLERY_FULL' | 'REJECTED';
  message?: string;
}

export interface MediaLibraryUploadPort {
  upload(args: { files: Array<{ filename: string; mime: string; buffer: Buffer }>; altText?: string | null; caption?: string | null; actorId: string }): Promise<Array<
    | { kind: 'STORED'; asset: { id: string; url: string }; deduplicated: boolean }
    | { kind: 'REJECTED'; filename: string; reason: string }
  >>;
}

export interface ProductGalleryUploadPort {
  assignAsCover(input: { productId: string; assetId: string; actorId: string }): Promise<{ ok: true; map: Array<{ slot: GallerySlot; assetId: string }> } | { ok: false; code: string; message: string }>;
  assignNextFree(input: { productId: string; assetId: string; actorId: string; altText?: string | null }): Promise<{ ok: true; map: Array<{ slot: GallerySlot; assetId: string }> } | { ok: false; code: string; message: string }>;
}

export class UploadProductImagesUseCase {
  constructor(
    private readonly library: MediaLibraryUploadPort,
    private readonly gallery: ProductGalleryUploadPort,
  ) {}

  async execute(input: UploadProductImagesInput): Promise<UploadedGalleryImage[]> {
    const { productId, files } = input;
    if (!productId) throw new Error('Product ID is required.');
    if (!input.actorId) throw new Error('An actor is required.');
    if (!files || files.length === 0) throw new Error('At least one image must be selected.');
    if (files.length > 4) throw new Error('A gallery holds at most four images. Choose up to four files.');

    for (const file of files) {
      const error = ImageFileValidator.validate({ filename: file.name, mimetype: file.type, size: file.size });
      if (error) throw new Error(error);
    }

    const results: UploadedGalleryImage[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const [stored] = await this.library.upload({ files: [{ filename: file.name, mime: file.type, buffer: file.buffer }], altText: input.altText ?? null, caption: null, actorId: input.actorId });
      if (!stored || stored.kind === 'REJECTED') {
        results.push({ assetId: '', url: '', slot: null, deduplicated: false, outcome: 'REJECTED', message: stored ? `Rejected: ${describeUploadRejection(stored.reason)}.` : 'Not stored.' });
        continue;
      }
      const wantsCover = i === 0 && input.makeFirstPrimary === true;
      const r = wantsCover
        ? await this.gallery.assignAsCover({ productId, assetId: stored.asset.id, actorId: input.actorId })
        : await this.gallery.assignNextFree({ productId, assetId: stored.asset.id, actorId: input.actorId, altText: input.altText ?? null });
      if (r.ok) {
        const slot = r.map.find((a) => a.assetId === stored.asset.id)?.slot ?? null;
        results.push({ assetId: stored.asset.id, url: stored.asset.url, slot, deduplicated: stored.deduplicated, outcome: slot === 1 ? 'COVER' : 'ASSIGNED' });
      } else if (r.code === 'DUPLICATE_ASSET') {
        results.push({ assetId: stored.asset.id, url: stored.asset.url, slot: null, deduplicated: stored.deduplicated, outcome: 'ALREADY_IN_GALLERY', message: r.message });
      } else if (r.code === 'INVALID_SLOT') {
        results.push({ assetId: stored.asset.id, url: stored.asset.url, slot: null, deduplicated: stored.deduplicated, outcome: 'GALLERY_FULL', message: r.message });
      } else {
        throw new Error(r.message);
      }
    }
    return results;
  }
}
