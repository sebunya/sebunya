/**
 * Battery catalogue, compatibility and finder: the vocabulary shared by the API,
 * the storefront and the admin. Statuses are closed sets mirrored by CHECK
 * constraints in migration 0125; public result states are DERIVED from evidence,
 * workflow and stock, never stored.
 */

export const BATTERY_CATEGORIES = ['PHONE', 'MIFI_ROUTER', 'OTHER'] as const;
export type BatteryCategory = (typeof BATTERY_CATEGORIES)[number];

export const BATTERY_CATEGORY_LABELS: Record<BatteryCategory, string> = {
  PHONE: 'Phone Batteries',
  MIFI_ROUTER: 'MiFi & Router Batteries',
  OTHER: 'Other Batteries',
};

export const BATTERY_CODE_STATUSES = ['CONFIRMED', 'PROVISIONAL', 'DEVICE_NAMED', 'MISSING'] as const;
export type BatteryCodeStatus = (typeof BATTERY_CODE_STATUSES)[number];

export const BATTERY_CHEMISTRIES = ['LI_ION', 'LI_POLYMER', 'NIMH', 'OTHER'] as const;
export type BatteryChemistry = (typeof BATTERY_CHEMISTRIES)[number];

export const BATTERY_LIFECYCLE_STATUSES = ['DRAFT', 'REVIEW', 'READY', 'ACTIVE', 'ARCHIVED'] as const;
export type BatteryLifecycleStatus = (typeof BATTERY_LIFECYCLE_STATUSES)[number];

export const BATTERY_ALIAS_TYPES = ['CANONICAL', 'SUPPLIER', 'BARCODE', 'CUSTOMER', 'LEGACY', 'SEARCH', 'DEVICE_NAME'] as const;
export type BatteryAliasType = (typeof BATTERY_ALIAS_TYPES)[number];

export const COMPAT_EVIDENCE_STATUSES = ['SUPPLIER_LISTED', 'PACKAGE_VERIFIED', 'FIT_TESTED', 'VERIFIED_EXACT', 'CONDITIONAL', 'REJECTED'] as const;
export type CompatEvidenceStatus = (typeof COMPAT_EVIDENCE_STATUSES)[number];

export const COMPAT_WORKFLOW_STATUSES = ['DRAFT', 'REVIEW', 'READY', 'ACTIVE', 'ARCHIVED'] as const;
export type CompatWorkflowStatus = (typeof COMPAT_WORKFLOW_STATUSES)[number];

/** Evidence levels a verifier may confirm. Rejected and supplier-listed are not "verified". */
export const VERIFIED_EVIDENCE_STATUSES: readonly CompatEvidenceStatus[] = ['PACKAGE_VERIFIED', 'FIT_TESTED', 'VERIFIED_EXACT'];

export const EVIDENCE_KINDS = ['FRONT', 'BACK', 'LABEL', 'CONNECTOR', 'PACKAGING', 'BARCODE', 'FIT_TEST', 'DOCUMENT', 'OTHER'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * What a customer is told about one battery for one device. Derived, never
 * stored: evidence level x publication x stock.
 */
export const PUBLIC_FIT_STATES = [
  'VERIFIED_IN_STOCK',
  'VERIFIED_OUT_OF_STOCK',
  'CONDITIONAL',
  'AWAITING_VERIFICATION',
] as const;
export type PublicFitState = (typeof PUBLIC_FIT_STATES)[number];

export const PUBLIC_FIT_LABELS: Record<PublicFitState, string> = {
  VERIFIED_IN_STOCK: 'Verified fit, in stock',
  VERIFIED_OUT_OF_STOCK: 'Verified fit, out of stock',
  CONDITIONAL: 'Fits with a condition',
  AWAITING_VERIFICATION: 'Listed by the supplier, not yet checked by us',
};

export const MOVEMENT_TYPES = ['OPENING', 'RECEIPT', 'COUNT', 'ADJUSTMENT', 'DAMAGED', 'LOST', 'RETURN', 'CORRECTION'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const BATTERY_IMPORT_TYPES = ['BATTERY_CATALOGUE', 'COMPATIBILITY', 'STOCK_RECEIPT', 'STOCK_COUNT', 'PRICE_UPDATE'] as const;
export type BatteryImportType = (typeof BATTERY_IMPORT_TYPES)[number];

export const BATTERY_REQUEST_STATUSES = ['OPEN', 'MAPPED_DEVICE', 'ALIAS_ADDED', 'BATTERY_MAPPED', 'DRAFT_CREATED', 'INVALID', 'RESOLVED'] as const;
export type BatteryRequestStatus = (typeof BATTERY_REQUEST_STATUSES)[number];

/**
 * The owner's storefront price floor (2026-08-17): nothing on the site shows a
 * price below this. A battery priced under it cannot be published. One named
 * constant until an admin module owns the value.
 */
export const STOREFRONT_PRICE_FLOOR_UGX = 145_000;

export const BRAND_ORDER_MODES = ['FEATURED_THEN_COVERAGE', 'MANUAL', 'ALPHABETICAL'] as const;
export type BrandOrderMode = (typeof BRAND_ORDER_MODES)[number];

/** Admin-owned finder copy and ordering. Singleton JSONB document (battery_finder_config). */
export interface BatteryFinderConfig {
  headline: string;
  intro: string;
  findByPhoneLabel: string;
  searchByCodeLabel: string;
  searchPlaceholder: string;
  modelNumberHelp: string;
  noResultHeadline: string;
  noResultBody: string;
  requestCta: string;
  whatsappPrefill: string;
  awaitingVerificationNote: string;
  conditionalNote: string;
  outOfStockNote: string;
  brandOrderMode: BrandOrderMode;
  showAwaitingVerification: boolean;
  minVerifiedFitsForIndexing: number;
}

export const DEFAULT_BATTERY_FINDER_CONFIG: BatteryFinderConfig = {
  headline: 'Find the right battery for your phone',
  intro: 'Choose your phone or type a battery code. We only show batteries we have checked against that phone, and we say when a fit has not been checked yet.',
  findByPhoneLabel: 'Find by phone',
  searchByCodeLabel: 'Search by battery code',
  searchPlaceholder: 'Phone model or battery code, for example Spark 7 or BL-49FT',
  modelNumberHelp: 'Your exact model number is printed on the back of the phone or under the battery cover, and in Settings under About phone. It looks like KF6n, X695 or SM-A326B.',
  noResultHeadline: 'We have not matched a battery to this phone yet',
  noResultBody: 'That does not mean one does not exist. We will not guess with your phone. Check the exact model number, try again, or send us the details and we will confirm before you buy.',
  requestCta: 'Ask us to find this battery',
  whatsappPrefill: 'Hello GoldPlus, I need a battery for my ',
  awaitingVerificationNote: 'A supplier lists this battery for your phone. We have not checked the fit ourselves yet, so confirm with us before you buy.',
  conditionalNote: 'This battery fits with a condition. Read it before you order.',
  outOfStockNote: 'We have checked this fit but the battery is out of stock right now. Ask us when it is back.',
  brandOrderMode: 'FEATURED_THEN_COVERAGE',
  showAwaitingVerification: true,
  minVerifiedFitsForIndexing: 5,
};

const MAX_TEXT: Record<keyof BatteryFinderConfig, number> = {
  headline: 120,
  intro: 600,
  findByPhoneLabel: 60,
  searchByCodeLabel: 60,
  searchPlaceholder: 120,
  modelNumberHelp: 600,
  noResultHeadline: 120,
  noResultBody: 800,
  requestCta: 60,
  whatsappPrefill: 200,
  awaitingVerificationNote: 400,
  conditionalNote: 300,
  outOfStockNote: 300,
  brandOrderMode: 40,
  showAwaitingVerification: 5,
  minVerifiedFitsForIndexing: 4,
};

/** Validate an admin-submitted finder config. Returns plain-language errors. */
export function validateBatteryFinderConfig(input: unknown): { ok: true; value: BatteryFinderConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['Config must be an object.'] };
  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_BATTERY_FINDER_CONFIG) as Array<keyof BatteryFinderConfig>) {
    const value = raw[key];
    const fallback = DEFAULT_BATTERY_FINDER_CONFIG[key];
    if (typeof fallback === 'boolean') {
      if (typeof value !== 'boolean') errors.push(`${key} must be true or false.`);
      else out[key] = value;
    } else if (typeof fallback === 'number') {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1000) errors.push(`${key} must be a whole number between 0 and 1000.`);
      else out[key] = value;
    } else if (key === 'brandOrderMode') {
      if (!BRAND_ORDER_MODES.includes(value as BrandOrderMode)) errors.push(`brandOrderMode must be one of ${BRAND_ORDER_MODES.join(', ')}.`);
      else out[key] = value;
    } else {
      if (typeof value !== 'string' || value.trim().length === 0) errors.push(`${key} is required.`);
      else if (value.length > MAX_TEXT[key]) errors.push(`${key} must be ${MAX_TEXT[key]} characters or fewer.`);
      else if (/[–—]/.test(value)) errors.push(`${key} must not contain an em or en dash.`);
      else out[key] = value.trim();
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out as unknown as BatteryFinderConfig };
}

/** Public finder DTOs (what the storefront renders). No cost, supplier or internal note ever appears here. */
export interface FinderBrandDto {
  id: string;
  name: string;
  slug: string;
  isFeatured: boolean;
  verifiedFits: number;
  deviceCount: number;
}

export interface FinderSeriesDto {
  id: string;
  name: string;
  slug: string;
  deviceCount: number;
}

export interface FinderDeviceDto {
  id: string;
  slug: string;
  brandName: string;
  seriesName: string | null;
  model: string;
  modelNumber: string | null;
  variant: string | null;
  label: string;
  releaseYear: number | null;
  verifiedFits: number;
}

export interface FinderBatteryResultDto {
  productId: string;
  slug: string;
  name: string;
  canonicalCode: string;
  imageUrl: string | null;
  priceUgx: number | null;
  inStock: boolean;
  fitState: PublicFitState;
  fitLabel: string;
  condition: string | null;
  capacityMah: number | null;
  nominalVoltageMv: number | null;
}

export type FinderResolution =
  | { kind: 'DEVICE'; device: FinderDeviceDto; results: FinderBatteryResultDto[] }
  | { kind: 'BATTERY'; battery: FinderBatteryResultDto; devices: FinderDeviceDto[] }
  | { kind: 'AMBIGUOUS_DEVICE'; devices: FinderDeviceDto[]; message: string }
  | { kind: 'SUGGESTIONS'; devices: FinderDeviceDto[]; batteries: Array<{ canonicalCode: string; slug: string; name: string }>; message: string }
  | { kind: 'NO_RESULT'; message: string };
