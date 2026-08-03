export interface MediaVariantRecord {
  purpose: 'thumb' | 'card' | 'pdp' | 'zoom';
  format: 'avif' | 'webp' | 'jpeg';
  width: number;
  height: number;
  byteSize: number;
  storageKey: string;
  url: string;
}

export interface MediaAssetRecord {
  id: string;
  filename: string;
  mime: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksum: string;
  storageKey: string;
  url: string;
  altText: string | null;
  caption: string | null;
  rights: string | null;
  rightsExpiresAt: Date | null;
  focalX: number | null;
  focalY: number | null;
  status: 'ACTIVE' | 'ARCHIVED';
  createdBy: string | null;
  createdAt: Date;
  usageCount: number;
  variants: MediaVariantRecord[];
}

export interface MediaUsageRecord {
  entity: string;
  entityId: string;
  field: string;
  createdAt: Date;
}

export interface IMediaLibraryRepository {
  findByChecksum(checksum: string): Promise<MediaAssetRecord | null>;
  findById(id: string): Promise<MediaAssetRecord | null>;
  create(asset: {
    filename: string;
    mime: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    checksum: string;
    storageKey: string;
    url: string;
    altText: string | null;
    caption: string | null;
    createdBy: string | null;
  }): Promise<MediaAssetRecord>;
  addVariants(assetId: string, variants: MediaVariantRecord[]): Promise<void>;
  list(args: {
    query?: string;
    status?: 'ACTIVE' | 'ARCHIVED';
    mime?: string;
    page: number;
    limit: number;
  }): Promise<{ items: MediaAssetRecord[]; total: number }>;
  updateMetadata(
    id: string,
    patch: Partial<Pick<MediaAssetRecord, 'altText' | 'caption' | 'rights' | 'rightsExpiresAt' | 'focalX' | 'focalY'>>,
  ): Promise<MediaAssetRecord | null>;
  setStatus(id: string, status: 'ACTIVE' | 'ARCHIVED'): Promise<MediaAssetRecord | null>;
  usages(assetId: string): Promise<MediaUsageRecord[]>;
  recordUsage(assetId: string, entity: string, entityId: string, field: string): Promise<void>;
  removeUsage(assetId: string, entity: string, entityId: string, field: string): Promise<void>;
  /** Hard-deletes the DB row. Callers must have proven zero usages first. */
  deleteRow(id: string): Promise<void>;
  /** Products whose catalogue row has no usable image — the repair worklist. */
  productsMissingImages(): Promise<Array<{ id: string; name: string; slug: string }>>;
  /** Points the product's primary image at the asset's URL (catalogue + gallery). */
  assignPrimaryProductImage(productId: string, asset: MediaAssetRecord): Promise<{ productId: string; url: string } | null>;
}

export interface IMediaVariantGenerator {
  /**
   * Best-effort derivative generation. Returns [] (with an internal log) when the
   * image engine is unavailable — the original is always stored regardless, and
   * dimensions stay null rather than fabricated.
   */
  generate(args: {
    buffer: Buffer;
    mime: string;
    checksum: string;
    saveVariant: (key: string, buffer: Buffer) => Promise<{ url: string; storageKey: string }>;
  }): Promise<{ width: number | null; height: number | null; variants: MediaVariantRecord[] }>;
}
