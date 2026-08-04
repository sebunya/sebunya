/**
 * Admin Locations section ports (brief PART J.1).
 */

export interface SearchMissGroup {
  normalisedQuery: string;
  rawSamples: string[];
  frequency: number;
  lastSeen: string;
  resolvedVia: Record<string, number>;
  topResolvedAreaSlug: string | null;
}

export interface ReviewQueueAddress {
  id: string;
  userId: string | null;
  recipientName: string;
  phone: string;
  district: string;
  areaDetails: string;
  rawAddressText: string | null;
  landmarkText: string | null;
  hasPin: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
  resolutionStatus: string;
  createdAt: string;
}

export interface LandmarkRow {
  id: string;
  areaSlug: string;
  name: string;
  landmarkType: string;
  usageCount: number;
  verified: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
}

export interface PickupPointRow {
  id: string;
  name: string;
  operator: string;
  areaSlug: string | null;
  physicalAddress: string | null;
  landmarkText: string | null;
  phone: string | null;
  openingHours: unknown;
  servesDistricts: string[] | null;
  active: boolean;
  notes: string | null;
}

export interface ZonePolicyRow {
  zoneCode: string;
  zoneName: string;
  slaHoursMin: number | null;
  slaHoursMax: number | null;
  fallbackFeeUgx: number | null;
  freeDeliveryThresholdUgx: number | null;
  codAllowed: boolean | null;
  codMaxOrderValueUgx: number | null;
  prepayRequiredAboveUgx: number | null;
  carrier: string | null;
  active: boolean;
}

export interface DataExceptionRow {
  id: string;
  exceptionType: string;
  district: string | null;
  postcode: string | null;
  areaRef: string | null;
  description: string | null;
}

export interface ILocationAdminRepository {
  listSearchMissGroups(limit: number): Promise<SearchMissGroup[]>;
  areaExists(areaSlug: string): Promise<boolean>;
  createAlias(input: {
    alias: string;
    normalisedAlias: string;
    areaSlug: string;
    confidence: string;
    source: 'ops_promoted';
    createdBy: string;
    note?: string | null;
  }): Promise<{ created: boolean }>;
  markMissesResolved(normalisedQuery: string, areaSlug: string): Promise<number>;

  listReviewQueue(limit: number): Promise<ReviewQueueAddress[]>;
  resolveAddress(input: {
    addressId: string;
    areaSlug: string;
    snapshotAreaLabel: string;
    snapshotDistrict: string;
    snapshotPostcode: string | null;
    snapshotDataVersion: number | null;
  }): Promise<{ before: unknown; after: unknown } | null>;
  areaSummary(areaSlug: string): Promise<{ displayLabel: string; currentDistrict: string; postcode: string | null; dataVersion: number } | null>;

  listLandmarks(areaSlug: string | null, limit: number): Promise<LandmarkRow[]>;
  upsertLandmark(input: {
    areaSlug: string;
    name: string;
    landmarkType: string;
    verified?: boolean;
    gpsLat?: number | null;
    gpsLng?: number | null;
  }): Promise<LandmarkRow>;
  setLandmarkVerified(id: string, verified: boolean): Promise<boolean>;
  mergeLandmarks(keepId: string, mergeId: string): Promise<boolean>;

  listPickupPoints(): Promise<PickupPointRow[]>;
  upsertPickupPoint(input: Partial<PickupPointRow> & { name: string; operator: string }): Promise<PickupPointRow>;
  setPickupPointActive(id: string, active: boolean): Promise<boolean>;

  listZonePolicies(): Promise<ZonePolicyRow[]>;
  saveZonePolicy(input: ZonePolicyRow & { updatedBy: string }): Promise<ZonePolicyRow>;

  listDataExceptions(): Promise<DataExceptionRow[]>;
}
