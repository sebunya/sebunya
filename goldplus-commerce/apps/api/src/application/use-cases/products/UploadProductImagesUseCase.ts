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

/**
 * A refusal whose message is written for the operator. The route returns it
 * verbatim; anything else stays behind a generic message.
 */
export class ProductUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductUploadError';
  }
}

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
    if (!productId) throw new ProductUploadError('Product ID is required.');
    if (!input.actorId) throw new ProductUploadError('An actor is required.');
    if (!files || files.length === 0) throw new ProductUploadError('At least one image must be selected.');
    if (files.length > 4) throw new ProductUploadError('A gallery holds at most four images. Choose up to four files.');
    // No separate pre-check: the media library judges each file by its CONTENT
    // (magic bytes) with the same 15 MB / pixel budgets as every other upload
    // path, and reports a per-file reason. A stricter 5 MB / declared-MIME gate
    // here refused ordinary phone photos with no reason given.

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
        throw new ProductUploadError(r.message);
      }
    }
    return results;
  }
}

/**
 * How many files actually reached the gallery, and a sentence naming why the
 * others did not. The route used to answer success for a batch in which every
 * file was rejected or the gallery was full.
 */
export function summariseProductUpload(results: UploadedGalleryImage[]): { stored: number; message: string } {
  const stored = results.filter((r) => r.outcome === 'ASSIGNED' || r.outcome === 'COVER').length;
  const problems = results
    .filter((r) => r.outcome !== 'ASSIGNED' && r.outcome !== 'COVER')
    .map((r) => r.message ?? (r.outcome === 'ALREADY_IN_GALLERY' ? 'Already in this gallery.' : r.outcome === 'GALLERY_FULL' ? 'The gallery is full (four images).' : 'Not stored.'));
  const unique = Array.from(new Set(problems));
  const message = stored === 0
    ? `No photo was stored. ${unique.join(' ')}`.trim()
    : `${stored} of ${results.length} photos stored. ${unique.join(' ')}`.trim();
  return { stored, message };
}
