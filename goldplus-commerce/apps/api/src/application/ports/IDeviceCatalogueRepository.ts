/**
 * Device hierarchy port: brand → series → exact model. Merge moves
 * compatibility rows and preserves history.
 */

export interface DeviceBrandRecord {
  id: string;
  name: string;
  nameNormalised: string;
  slug: string;
  searchAliases: string[];
  logoAssetId: string | null;
  logoUrl: string | null;
  isFeatured: boolean;
  displayOrder: number;
  status: 'ACTIVE' | 'ARCHIVED';
  deviceCount: number;
  verifiedFits: number;
  demandCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceSeriesRecord {
  id: string;
  brandId: string;
  name: string;
  slug: string;
  searchAliases: string[];
  displayOrder: number;
  status: 'ACTIVE' | 'ARCHIVED';
  deviceCount: number;
  verifiedFits: number;
  demandCount: number;
}

export interface DeviceRecord {
  id: string;
  brandId: string | null;
  brandName: string;
  seriesId: string | null;
  seriesName: string | null;
  model: string;
  modelNumber: string | null;
  variant: string | null;
  slug: string;
  modelAliases: string[];
  releaseYear: number | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'MERGED';
  displayOrder: number;
  mergedIntoDeviceId: string | null;
  sourceReference: string | null;
  claimCount: number;
  verifiedFits: number;
  demandCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrandInput {
  name: string;
  nameNormalised: string;
  slug: string;
  searchAliases: string[];
  searchAliasesNormalised: string[];
  isFeatured: boolean;
  displayOrder: number;
  logoAssetId: string | null;
  actorId: string;
}

export interface SeriesInput {
  brandId: string;
  name: string;
  nameNormalised: string;
  slug: string;
  searchAliases: string[];
  searchAliasesNormalised: string[];
  displayOrder: number;
  actorId: string;
}

export interface DeviceInput {
  brandId: string;
  brandName: string;
  brandNormalised: string;
  seriesId: string | null;
  model: string;
  modelNormalised: string;
  modelNumber: string | null;
  modelNumberNormalised: string | null;
  variant: string | null;
  variantNormalised: string | null;
  modelAliases: string[];
  modelAliasesNormalised: string[];
  slug: string;
  releaseYear: number | null;
  displayOrder: number;
  sourceReference: string | null;
  actorId: string;
}

export interface DeviceListFilters {
  brandId?: string;
  seriesId?: string;
  q?: string;
  status?: 'ACTIVE' | 'ARCHIVED' | 'MERGED' | 'ALL';
  limit?: number;
}

export interface IDeviceCatalogueRepository {
  listBrands(includeArchived: boolean): Promise<DeviceBrandRecord[]>;
  findBrand(id: string): Promise<DeviceBrandRecord | null>;
  findBrandBySlug(slug: string): Promise<DeviceBrandRecord | null>;
  findBrandByNormalised(nameNormalised: string): Promise<DeviceBrandRecord | null>;
  createBrand(input: BrandInput): Promise<DeviceBrandRecord>;
  updateBrand(id: string, patch: Partial<BrandInput>): Promise<DeviceBrandRecord | null>;
  setBrandStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string): Promise<DeviceBrandRecord | null>;
  reorderBrands(orderedIds: string[], actorId: string): Promise<void>;

  listSeries(brandId: string, includeArchived: boolean): Promise<DeviceSeriesRecord[]>;
  findSeries(id: string): Promise<DeviceSeriesRecord | null>;
  findSeriesByNormalised(brandId: string, nameNormalised: string): Promise<DeviceSeriesRecord | null>;
  createSeries(input: SeriesInput): Promise<DeviceSeriesRecord>;
  updateSeries(id: string, patch: Partial<SeriesInput>): Promise<DeviceSeriesRecord | null>;
  setSeriesStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string): Promise<DeviceSeriesRecord | null>;
  reorderSeries(brandId: string, orderedIds: string[], actorId: string): Promise<void>;

  listDevices(filters: DeviceListFilters): Promise<DeviceRecord[]>;
  findDevice(id: string): Promise<DeviceRecord | null>;
  findDeviceBySlug(slug: string): Promise<DeviceRecord | null>;
  findDeviceByIdentity(identity: { brandNormalised: string; modelNormalised: string; modelNumberNormalised: string | null; variantNormalised: string | null }): Promise<DeviceRecord | null>;
  createDevice(input: DeviceInput): Promise<DeviceRecord>;
  updateDevice(id: string, patch: Partial<DeviceInput>): Promise<DeviceRecord | null>;
  setDeviceStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string): Promise<DeviceRecord | null>;
  /** Compatibility product ids on a device (for the merge preview). */
  deviceMappingProducts(deviceId: string): Promise<string[]>;
  openRequestsForDevice(deviceId: string): Promise<number>;
  /** Move mappings, carry aliases, mark source MERGED, repoint requests. One transaction. */
  merge(sourceId: string, targetId: string, actorId: string, carryAliases: string[]): Promise<{ moved: number; archivedDuplicates: number }>;
}
