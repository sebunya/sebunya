import type { BatteryAliasType, BatteryCategory, BatteryChemistry, BatteryLifecycleStatus, EvidenceKind } from '@goldplus/shared';

/**
 * Battery catalogue port: one product = one battery profile. Cost and supplier
 * fields are admin-only; the finder read port (IBatteryFinderRepository) never
 * returns them.
 */

export interface BatteryProfileRecord {
  id: string;
  productId: string;
  canonicalCode: string;
  canonicalCodeNormalised: string;
  codeStatus: string;
  supplierCode: string | null;
  barcode: string | null;
  batteryCategory: BatteryCategory;
  chemistry: BatteryChemistry | null;
  nominalVoltageMv: number | null;
  capacityMah: number | null;
  wattHours: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  weightG: number | null;
  connectorNotes: string | null;
  warrantyMonths: number | null;
  supplierName: string | null;
  supplierReference: string | null;
  packagingNotes: string | null;
  safetyNotes: string | null;
  internalNotes: string | null;
  publicNotes: string | null;
  lifecycleStatus: BatteryLifecycleStatus;
  verificationStatus: string;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  publishedBy: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  sourceImportSessionId: string | null;
  sourceReference: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BatteryProductFacts {
  productId: string;
  sku: string;
  slug: string;
  name: string;
  shortDescription: string;
  longDescription: string;
  categoryName: string | null;
  subcategory: string | null;
  priceUgx: number;
  hasRetailPrice: boolean;
  hasImage: boolean;
  primaryImageUrl: string | null;
  imageCount: number;
  approvalStatus: string;
  active: boolean;
  stockQuantity: number;
  reservedQuantity: number;
  stockStatus: string;
  movementCount: number;
}

export interface BatteryAliasRecord {
  id: string;
  batteryProductId: string;
  alias: string;
  aliasNormalised: string;
  aliasType: BatteryAliasType;
  source: string | null;
  verificationStatus: string;
  isActive: boolean;
  createdAt: Date;
}

export interface EvidenceAssetRecord {
  id: string;
  subjectType: 'BATTERY' | 'COMPATIBILITY';
  subjectId: string;
  assetId: string;
  url: string;
  kind: EvidenceKind;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface BatteryListFilters {
  q?: string;
  status?: BatteryLifecycleStatus | 'ALL';
  category?: BatteryCategory;
  missing?: 'price' | 'image' | 'stock' | 'specs' | 'compatibility' | 'code';
  verification?: 'UNVERIFIED' | 'VERIFIED';
  limit?: number;
}

export interface BatteryListRow {
  profile: BatteryProfileRecord;
  product: BatteryProductFacts;
  aliasCount: number;
  compatibility: { total: number; active: number; ready: number; review: number; draft: number; verified: number };
}

export interface BatteryCreateInput {
  actorId: string;
  categoryId: string;
  categoryName: string;
  subcategory: string;
  sku: string;
  slug: string;
  name: string;
  shortDescription: string;
  longDescription: string;
  priceUgx: number;
  profile: Omit<Partial<BatteryProfileRecord>, 'id' | 'productId' | 'createdAt' | 'updatedAt'> & { canonicalCode: string; canonicalCodeNormalised: string; batteryCategory: BatteryCategory };
  aliases: Array<{ alias: string; aliasNormalised: string; aliasType: BatteryAliasType; source: string | null }>;
}

export interface BatteryDashboardCounts {
  total: number;
  active: number;
  draft: number;
  review: number;
  ready: number;
  archived: number;
  withoutStock: number;
  withoutPrice: number;
  withoutImage: number;
  missingSpecs: number;
  unverifiedBatteries: number;
  unverifiedClaims: number;
  claimsInReview: number;
  conditionalClaims: number;
  aliasConflicts: number;
  unresolvedImportRows: number;
  openRequests: number;
  recentChanges: Array<{ entity: string; entityId: string; action: string; at: Date; actorId: string | null; label: string | null }>;
}

export interface IBatteryCatalogueRepository {
  findCategoryBySlug(slug: string): Promise<{ id: string; name: string } | null>;
  create(input: BatteryCreateInput): Promise<{ productId: string; profileId: string }>;
  findByProductId(productId: string): Promise<{ profile: BatteryProfileRecord; product: BatteryProductFacts } | null>;
  /** 0127 — the battery's own floor (Price A) from product_prices, or null when none is set. */
  floorPriceFor?(productId: string): Promise<number | null>;
  findByProductSlug(slug: string): Promise<{ profile: BatteryProfileRecord; product: BatteryProductFacts } | null>;
  list(filters: BatteryListFilters): Promise<BatteryListRow[]>;
  updateProfile(productId: string, patch: Partial<BatteryProfileRecord>, actorId: string): Promise<BatteryProfileRecord | null>;
  updateProduct(productId: string, patch: { name?: string; shortDescription?: string; longDescription?: string; subcategory?: string; slug?: string }): Promise<void>;
  /** The ONE price write: products.price_ugx and product_prices.retail_price together. */
  setRetailPrice(productId: string, priceUgx: number): Promise<{ before: number; after: number }>;
  /** Product publication flags follow the profile lifecycle. */
  setProductPublication(productId: string, published: boolean): Promise<void>;
  skuExists(sku: string): Promise<boolean>;
  slugExists(slug: string): Promise<boolean>;

  aliasesFor(productId: string): Promise<BatteryAliasRecord[]>;
  /** Active owners of any of the given normalised aliases (canonical codes count as aliases). */
  aliasOwners(normalised: string[]): Promise<Array<{ aliasNormalised: string; productId: string; canonicalCode: string }>>;
  addAlias(input: { productId: string; alias: string; aliasNormalised: string; aliasType: BatteryAliasType; source: string | null; verificationStatus?: string; actorId: string }): Promise<BatteryAliasRecord>;
  setAliasActive(aliasId: string, active: boolean): Promise<BatteryAliasRecord | null>;
  /** Exact resolution of a typed code/barcode/alias through candidate forms. */
  resolveCode(candidates: string[], barcode: string | null): Promise<Array<{ productId: string; canonicalCode: string; lifecycleStatus: string; matchedOn: string }>>;
  /** Bounded trigram suggestions for codes that did not resolve exactly. */
  suggestCodes(normalisedQuery: string, limit: number): Promise<Array<{ productId: string; canonicalCode: string; slug: string; name: string; score: number }>>;

  addEvidence(input: { subjectType: 'BATTERY' | 'COMPATIBILITY'; subjectId: string; assetId: string; kind: EvidenceKind; note: string | null; actorId: string }): Promise<EvidenceAssetRecord>;
  evidenceFor(subjectType: 'BATTERY' | 'COMPATIBILITY', subjectId: string): Promise<EvidenceAssetRecord[]>;
  setPrimaryImageFromAsset(productId: string, assetId: string, url: string, altText: string | null): Promise<void>;

  dashboard(): Promise<BatteryDashboardCounts>;
  /** Compatibility facts the readiness check needs. */
  mappingsSummary(productId: string): Promise<Array<{ id: string; workflowStatus: string; evidenceStatus: string; deviceStatus: string }>>;
}
