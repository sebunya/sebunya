import type { BatteryFinderConfig, BatteryRequestStatus, FinderBatteryResultDto, FinderBrandDto, FinderDeviceDto, FinderSeriesDto } from '@goldplus/shared';
import type { BatteryCandidate, DeviceCandidate } from '../../domain/batteries/FinderRanking';

/**
 * Public finder reads + demand writes. Everything returned here is safe to show
 * a customer: no cost, supplier, internal note or unpublished claim.
 */

export interface PublicFitRow {
  claimId: string;
  productId: string;
  deviceId: string;
  evidenceStatus: string;
  workflowStatus: string;
  publicCondition: string | null;
  batteryLifecycle: string;
  productApproved: boolean;
  productActive: boolean;
  stockQuantity: number;
  product: Omit<FinderBatteryResultDto, 'fitState' | 'fitLabel' | 'condition' | 'inStock'>;
  device: FinderDeviceDto;
}

export interface FinderEventWrite {
  eventType: 'SEARCH' | 'DEVICE_SELECTED' | 'RESULT_VIEWED' | 'PRODUCT_VIEWED' | 'ADDED_TO_CART' | 'REQUEST_SUBMITTED';
  mode: 'FIND_BY_PHONE' | 'SEARCH_CODE' | 'PRODUCT_PAGE' | 'CART';
  queryNormalised: string | null;
  outcome: string;
  brandId: string | null;
  seriesId: string | null;
  deviceId: string | null;
  batteryProductId: string | null;
  resultCount: number;
  aliasHit: boolean;
  sessionHash: string | null;
}

export interface BatteryRequestRecord {
  id: string;
  createdAt: Date;
  source: string;
  queryText: string | null;
  queryNormalised: string | null;
  brandText: string | null;
  deviceText: string | null;
  modelNumberText: string | null;
  batteryCodeText: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  status: BatteryRequestStatus;
  resolutionNote: string | null;
  resolvedDeviceId: string | null;
  resolvedAliasId: string | null;
  resolvedBatteryProductId: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
}

export interface DemandOverview {
  since: Date;
  topBrands: Array<{ brandId: string | null; name: string; searches: number }>;
  topDevices: Array<{ deviceId: string; label: string; searches: number; verifiedFits: number }>;
  topCodes: Array<{ query: string; searches: number }>;
  noResultQueries: Array<{ query: string; searches: number; lastAt: Date }>;
  devicesWithoutBattery: Array<{ deviceId: string; label: string; searches: number }>;
  outOfStockDemand: Array<{ productId: string; canonicalCode: string; name: string; views: number }>;
  searchToProduct: { searches: number; productViews: number; rate: number };
  searchToCart: { searches: number; cartAdds: number; rate: number };
  aliasCorrections: Array<{ query: string; searches: number }>;
  ambiguousQueries: Array<{ query: string; searches: number }>;
}

export interface IBatteryFinderRepository {
  getConfig(): Promise<{ config: BatteryFinderConfig; version: number } | null>;
  seedConfig(config: BatteryFinderConfig): Promise<{ inserted: boolean }>;
  saveConfig(config: BatteryFinderConfig, expectedVersion: number, actorId: string): Promise<{ version: number } | null>;

  brands(showAwaiting: boolean): Promise<FinderBrandDto[]>;
  brandBySlug(slug: string, showAwaiting: boolean): Promise<{ brand: FinderBrandDto; series: FinderSeriesDto[]; devices: Array<FinderDeviceDto & { seriesId: string | null; displayOrder: number; demandCount: number }> } | null>;
  deviceBySlug(slug: string): Promise<FinderDeviceDto | null>;
  deviceById(id: string): Promise<FinderDeviceDto | null>;
  /** Every public fit row for a device (workflow ACTIVE only; the caller derives the state). */
  fitsForDevice(deviceId: string): Promise<PublicFitRow[]>;
  fitsForBattery(productId: string): Promise<PublicFitRow[]>;
  batteryPublic(productId: string): Promise<(PublicFitRow['product'] & { lifecycleStatus: string; stockQuantity: number; productApproved: boolean; productActive: boolean }) | null>;
  batteryPublicBySlug(slug: string): Promise<(PublicFitRow['product'] & { lifecycleStatus: string; publicNotes: string | null; warrantyMonths: number | null; chemistry: string | null }) | null>;

  /** Candidate sets for ranking (active devices and non-archived batteries). */
  deviceCandidates(): Promise<DeviceCandidate[]>;
  batteryCandidates(): Promise<BatteryCandidate[]>;
  fuzzyDevices(query: string, limit: number): Promise<Array<{ id: string; score: number }>>;
  fuzzyBatteries(queryNormalised: string, limit: number): Promise<Array<{ productId: string; score: number }>>;
  verifiedFitCount(): Promise<number>;

  recordEvent(event: FinderEventWrite): Promise<void>;
  createRequest(input: Omit<BatteryRequestRecord, 'id' | 'createdAt' | 'status' | 'resolutionNote' | 'resolvedDeviceId' | 'resolvedAliasId' | 'resolvedBatteryProductId' | 'resolvedBy' | 'resolvedAt'> & { sessionHash: string | null }): Promise<BatteryRequestRecord>;
  listRequests(status: BatteryRequestStatus | 'ALL', limit: number): Promise<BatteryRequestRecord[]>;
  findRequest(id: string): Promise<BatteryRequestRecord | null>;
  resolveRequest(id: string, patch: { status: BatteryRequestStatus; resolutionNote: string | null; resolvedDeviceId?: string | null; resolvedAliasId?: string | null; resolvedBatteryProductId?: string | null; resolvedBy: string }): Promise<BatteryRequestRecord | null>;
  demandOverview(sinceDays: number): Promise<DemandOverview>;
}
