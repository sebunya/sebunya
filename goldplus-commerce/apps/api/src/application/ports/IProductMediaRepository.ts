import type { GallerySlot } from '@goldplus/shared';
import type { SlotAssignment, SlotMap } from '../../domain/media/ProductMediaSlotMap';

/** One gallery row as the admin editor and the backfill see it. */
export interface ProductMediaRow {
  imageId: string;
  assetId: string | null;
  slot: GallerySlot | null;
  /** Legacy projection, kept for unmigrated products. */
  isPrimary: boolean;
  displayOrder: number;
  /** The stored original URL (product_images.url). */
  url: string;
  altText: string | null;
  asset: {
    filename: string;
    width: number | null;
    height: number | null;
    byteSize: number;
    status: string;
    /** Storefront rendition (pdp/webp) URL when generated. */
    displayUrl: string | null;
    thumbUrl: string | null;
    ready: boolean;
  } | null;
}

export interface ProductMediaSnapshot {
  productId: string;
  sku: string;
  name: string;
  slug: string;
  mediaRevision: number;
  rows: ProductMediaRow[];
}

export interface ReadyAsset {
  id: string;
  url: string;
  altText: string | null;
}

export interface SlotMapAudit {
  actorId: string;
  action: string;
  previousMap: SlotMap;
  requestId?: string | null;
}

export type ApplySlotMapResult =
  | { kind: 'APPLIED'; mediaRevision: number; map: SlotAssignment[] }
  | { kind: 'STALE'; currentRevision: number }
  | { kind: 'NOT_FOUND' };

export interface IProductMediaRepository {
  getSnapshot(productId: string): Promise<ProductMediaSnapshot | null>;
  /** Assets that may enter a slot: ACTIVE and with the storefront rendition generated. */
  findReadyAssets(assetIds: readonly string[]): Promise<ReadyAsset[]>;
  /**
   * The ONE write path for gallery assignments. Locks the product row, compares
   * the revision, parks existing gallery rows at NULL, writes the new map,
   * projects is_primary/display_order and products.image_url/has_image,
   * maintains media_usages, increments media_revision and writes the audit row —
   * all in one transaction.
   */
  applySlotMap(productId: string, expectedRevision: number, map: SlotMap, audit: SlotMapAudit): Promise<ApplySlotMapResult>;
  /** Audit history of gallery writes for undo (newest first). */
  listGalleryAudit(productId: string, limit: number): Promise<Array<{ id: string; action: string; actorId: string | null; createdAt: Date; previousMap: SlotMap; newMap: SlotMap; revision: number }>>;
}
