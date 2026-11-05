import type { ProductAvailability, ProductPublicDto, RecommendationItemDto } from "@goldplus/shared";
import { getProductSubcategory } from "./product-discovery";
import { formatUgx } from "./money";

export type RecommendationRule =
  | "same_subcategory"
  | "same_category"
  | "complementary_category"
  | "same_brand_or_family"
  | "catalogue_fallback"
  | "eligible_candidates"
  | "empty";

export interface RecommendationCandidate {
  id?: string;
  productId?: string;
  slug?: string;
  name?: string;
  categoryName?: string;
  categorySlug?: string;
  subcategory?: string;
  subcategoryName?: string;
  brand?: string;
  family?: string;
  brandOrFamily?: string;
  imageUrl?: string | null;
  primaryImageUrl?: string | null;
  price?: number | null;
  floorPriceUgx?: number | null;
  retailPriceUgx?: number | null;
  availability?: ProductAvailability;
  archived?: boolean;
  hidden?: boolean;
  isActive?: boolean;
  status?: string;
  reasonCode?: string;
  [key: string]: unknown;
}

export interface NormalizedRecommendationCandidate {
  id: string;
  providedId: string | null;
  slug: string;
  name: string;
  category: string;
  subcategory: string;
  brandOrFamily: string;
  price: number | undefined;
  floorPriceUgx: number | null;
  priceDisplay: string;
  availability: ProductAvailability;
  availabilityDisplay: string;
  imageUrl: string | undefined;
  imageAlt: string;
  href: string;
  eligible: boolean;
  ineligibleReason: string | null;
}

export interface RecommendationSelectionOptions {
  currentProductId?: string;
  currentProductSlug?: string;
  currentCategory?: string;
  currentSubcategory?: string;
  currentBrandOrFamily?: string;
  complementaryCategories?: string[];
  complementarySubcategories?: string[];
  excludeIds?: string[];
  maxCount?: number;
  categoryDominanceCap?: number;
  minimumSameSubcategoryCandidates?: number;
  preferredRule?: "similar" | "complementary_category" | "catalogue_fallback";
}

export interface RecommendationSelectedDetail {
  id: string;
  slug: string;
  rule: Exclude<RecommendationRule, "eligible_candidates" | "empty">;
  explanation: string;
}

export interface RecommendationRulesPreview<T> {
  inputCount: number;
  normalizedCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  duplicateCount: number;
  currentProductExcluded: boolean;
  currentProductExcludedCount: number;
  excludedCount: number;
  beforeCount: number;
  afterCount: number;
  maxCount: number;
  categoryDominanceCap: number;
  categoryCapApplied: boolean;
  sparseCatalogueFill: boolean;
  sparseCatalogueFillReason: string | null;
  selectedRule: RecommendationRule;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  emptyReason: string | null;
  selectedDetails: RecommendationSelectedDetail[];
  selected: T[];
}

export const REVIEWED_COMPLEMENTARY_SUBCATEGORIES: Readonly<Record<string, readonly string[]>> = {
  "power-banks": ["chargers"],
  chargers: ["power-banks"],
  "car-chargers": ["mounts"],
  mounts: ["car-chargers"],
  "flash-drives": ["memory-cards"],
  "memory-cards": ["flash-drives"],
  earbuds: ["speakers"],
  speakers: ["earbuds"],
};

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function key(value: unknown): string {
  return clean(value).toLocaleLowerCase("en");
}

function suppliedId(item: RecommendationCandidate): string {
  return clean(item.id ?? item.productId);
}

function isSafeImageUrl(value: unknown): value is string {
  const candidate = clean(value);
  return /^https?:\/\//i.test(candidate) || /^\/(?!\/)/.test(candidate);
}

export function formatRecommendationPrice(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? formatUgx(value)
    : "Price on request";
}

export function recommendationAvailabilityLabel(availability: ProductAvailability | undefined): string {
  if (availability?.kind === "in_stock") return "In stock";
  if (availability?.kind === "out_of_stock") return "Out of stock";
  if (availability?.kind === "pre_order") return "Pre-order";
  return "Confirm availability";
}

/** Normalises one untrusted rendering-boundary candidate without inventing catalogue facts. */
export function normalizeRecommendationCandidate(
  item: RecommendationCandidate | null | undefined,
): NormalizedRecommendationCandidate {
  const providedId = item ? suppliedId(item) : "";
  const slug = key(item?.slug);
  const name = clean(item?.name);
  const category = key(item?.categoryName ?? item?.categorySlug);
  const subcategory = key(item?.subcategory ?? item?.subcategoryName);
  const brandOrFamily = key(item?.brandOrFamily ?? item?.brand ?? item?.family);
  const rawPrice = item?.price ?? item?.retailPriceUgx;
  const price = typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice > 0
    ? rawPrice
    : undefined;
  const rawFloor = item?.floorPriceUgx;
  const floorPriceUgx = typeof rawFloor === "number" && Number.isFinite(rawFloor) && rawFloor > 0 ? rawFloor : null;
  const availability = item?.availability ?? { kind: "unknown" };
  const image = item?.imageUrl ?? item?.primaryImageUrl;
  const imageUrl = isSafeImageUrl(image) ? clean(image) : undefined;
  const status = key(item?.status);

  let ineligibleReason: string | null = null;
  if (!item) ineligibleReason = "Candidate is missing.";
  else if (!providedId && !slug) ineligibleReason = "Stable product ID or slug is missing.";
  else if (!name) ineligibleReason = "Product name is missing.";
  else if (!SAFE_SLUG.test(slug)) ineligibleReason = "Safe PDP slug is missing.";
  else if (item.archived === true || item.hidden === true || item.isActive === false) {
    ineligibleReason = "Product is not public.";
  } else if (["archived", "hidden", "inactive", "deleted"].includes(status)) {
    ineligibleReason = "Product is not public.";
  }

  return {
    id: providedId || slug,
    providedId: providedId || null,
    slug,
    name,
    category,
    subcategory,
    brandOrFamily,
    price,
    floorPriceUgx,
    priceDisplay: formatRecommendationPrice(price),
    availability,
    availabilityDisplay: recommendationAvailabilityLabel(availability),
    imageUrl,
    imageAlt: name ? `${name} product image` : "Product image unavailable",
    href: SAFE_SLUG.test(slug) ? `/products/${slug}` : "/shop",
    eligible: ineligibleReason === null,
    ineligibleReason,
  };
}

/** Rejects incomplete, hidden, archived and unsafe recommendation candidates. */
export function isDisplayableRecommendation(item: RecommendationCandidate | null | undefined): boolean {
  return normalizeRecommendationCandidate(item).eligible;
}

/** Dedupes by product ID and slug, preserving the first eligible input. */
export function dedupeRecommendations<T extends RecommendationCandidate>(items: T[]): T[] {
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();

  return items.filter((item) => {
    const normalized = normalizeRecommendationCandidate(item);
    const id = key(normalized.providedId);
    if (!normalized.eligible) return false;
    if ((id && seenIds.has(id)) || seenSlugs.has(normalized.slug)) return false;
    if (id) seenIds.add(id);
    seenSlugs.add(normalized.slug);
    return true;
  });
}

function isCurrentProduct(
  normalized: NormalizedRecommendationCandidate,
  options: RecommendationSelectionOptions,
): boolean {
  const excludedIds = new Set((options.excludeIds ?? []).map(key).filter(Boolean));
  return Boolean(
    (options.currentProductId && key(normalized.providedId) === key(options.currentProductId)) ||
    (options.currentProductSlug && normalized.slug === key(options.currentProductSlug)) ||
    (normalized.providedId && excludedIds.has(key(normalized.providedId)))
  );
}

function ruleForCandidate(
  item: NormalizedRecommendationCandidate,
  options: RecommendationSelectionOptions,
): Exclude<RecommendationRule, "eligible_candidates" | "empty"> {
  const currentCategory = key(options.currentCategory);
  const currentSubcategory = key(options.currentSubcategory);
  const currentBrand = key(options.currentBrandOrFamily);
  const complementaryCategories = new Set((options.complementaryCategories ?? []).map(key).filter(Boolean));
  const complementarySubcategories = new Set((options.complementarySubcategories ?? []).map(key).filter(Boolean));

  if (currentSubcategory && item.subcategory === currentSubcategory) return "same_subcategory";
  if (currentCategory && item.category === currentCategory) return "same_category";
  if (
    (item.category && complementaryCategories.has(item.category)) ||
    (item.subcategory && complementarySubcategories.has(item.subcategory))
  ) return "complementary_category";
  if (currentBrand && item.brandOrFamily && item.brandOrFamily === currentBrand) return "same_brand_or_family";
  return "catalogue_fallback";
}

function explanationForRule(rule: RecommendationSelectedDetail["rule"]): string {
  if (rule === "same_subcategory") return "Shown from the same product family.";
  if (rule === "same_category") return "Shown from the same category.";
  if (rule === "complementary_category") return "Shown from an explicitly related catalogue family.";
  if (rule === "same_brand_or_family") return "Shown from the same recorded brand or family.";
  return "Shown from the available catalogue.";
}

function reasonCodeForRule(rule: RecommendationSelectedDetail["rule"]): string {
  if (rule === "same_subcategory") return "SAME_SUBCATEGORY";
  if (rule === "same_category") return "SAME_CATEGORY";
  if (rule === "complementary_category") return "COMPLEMENTARY_CATEGORY";
  if (rule === "same_brand_or_family") return "SAME_BRAND_OR_FAMILY";
  return "CATALOGUE_FALLBACK";
}

function sanitiseSelected<T extends RecommendationCandidate>(
  item: T,
  normalized: NormalizedRecommendationCandidate,
  rule: RecommendationSelectedDetail["rule"],
): T {
  return {
    ...item,
    productId: normalized.id,
    slug: normalized.slug,
    name: normalized.name,
    imageUrl: normalized.imageUrl,
    price: normalized.price,
    floorPriceUgx: normalized.floorPriceUgx,
    availability: normalized.availability,
    imageAlt: normalized.imageAlt,
    // The display boundary must NOT re-explain an item the engine already
    // explained. This used to stamp its own locally-derived rule over every
    // item, so engine rails rendered SAME_CATEGORY and COMPATIBLE_ACCESSORY as
    // CATALOGUE_FALLBACK: the reason badge disappeared, and — worse — every
    // impression and click event carried a reason dimension that described the
    // display helper rather than what actually served.
    //
    // A locally-derived rule is still correct for candidates that arrive with
    // no reason at all (the honest catalogue-fallback rail builds its items
    // that way), so it fills in only when the engine said nothing.
    reasonCode: typeof item.reasonCode === "string" && item.reasonCode.trim().length > 0
      ? item.reasonCode
      : reasonCodeForRule(rule),
  } as T;
}

/**
 * Pure rendering-boundary selector. Input order is the deterministic tie-breaker;
 * it does not infer popularity, customer intent or personalisation.
 */
export function previewRecommendationRules<T extends RecommendationCandidate>(
  candidates: T[],
  options: RecommendationSelectionOptions = {},
): RecommendationRulesPreview<T> {
  const maxCount = Math.max(1, Math.min(12, Math.trunc(options.maxCount ?? 4)));
  const categoryDominanceCap = Math.max(
    1,
    Math.min(maxCount, Math.trunc(options.categoryDominanceCap ?? 2)),
  );
  const minimumSameSubcategoryCandidates = Math.max(
    1,
    Math.min(maxCount, Math.trunc(options.minimumSameSubcategoryCandidates ?? 2)),
  );
  const normalizedInput = candidates.map((source) => ({ source, normalized: normalizeRecommendationCandidate(source) }));
  const displayable = normalizedInput.filter(({ normalized }) => normalized.eligible);
  const ineligibleCount = normalizedInput.length - displayable.length;
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  let duplicateCount = 0;
  const deduped = displayable.filter(({ normalized }) => {
    const id = key(normalized.providedId);
    if ((id && seenIds.has(id)) || seenSlugs.has(normalized.slug)) {
      duplicateCount += 1;
      return false;
    }
    if (id) seenIds.add(id);
    seenSlugs.add(normalized.slug);
    return true;
  });
  const currentProductExcludedCount = deduped.filter(({ normalized }) => isCurrentProduct(normalized, options)).length;
  const eligible = deduped.filter(({ normalized }) => !isCurrentProduct(normalized, options));

  const currentCategory = key(options.currentCategory);
  const currentSubcategory = key(options.currentSubcategory);
  const currentBrand = key(options.currentBrandOrFamily);
  const complementaryCategories = new Set((options.complementaryCategories ?? []).map(key).filter(Boolean));
  const complementarySubcategories = new Set((options.complementarySubcategories ?? []).map(key).filter(Boolean));
  const sameSubcategory = currentSubcategory
    ? eligible.filter(({ normalized }) => normalized.subcategory === currentSubcategory)
    : [];
  const sameCategory = currentCategory
    ? eligible.filter(({ normalized }) => normalized.category === currentCategory)
    : [];
  const complementary = eligible.filter(({ normalized }) =>
    (normalized.category && complementaryCategories.has(normalized.category)) ||
    (normalized.subcategory && complementarySubcategories.has(normalized.subcategory))
  );
  const sameBrandOrFamily = currentBrand
    ? eligible.filter(({ normalized }) => normalized.brandOrFamily && normalized.brandOrFamily === currentBrand)
    : [];

  let selectedRule: RecommendationRule = "empty";
  if (eligible.length > 0) {
    if (options.preferredRule === "catalogue_fallback") selectedRule = "catalogue_fallback";
    else if (options.preferredRule === "complementary_category" && complementary.length > 0) {
      selectedRule = "complementary_category";
    } else if (sameSubcategory.length >= minimumSameSubcategoryCandidates) selectedRule = "same_subcategory";
    else if (sameCategory.length > 0) selectedRule = "same_category";
    else if (complementary.length > 0) selectedRule = "complementary_category";
    else if (sameBrandOrFamily.length > 0) selectedRule = "same_brand_or_family";
    else if (currentCategory || currentSubcategory || currentBrand || complementaryCategories.size || complementarySubcategories.size) {
      selectedRule = "catalogue_fallback";
    } else selectedRule = "eligible_candidates";
  }

  const primaryPool = selectedRule === "same_subcategory" ? sameSubcategory
    : selectedRule === "same_category" ? sameCategory
      : selectedRule === "complementary_category" ? complementary
        : selectedRule === "same_brand_or_family" ? sameBrandOrFamily
          : eligible;
  const ordered: typeof eligible = [];
  const orderedSlugs = new Set<string>();
  for (const pool of [primaryPool, sameSubcategory, sameCategory, complementary, sameBrandOrFamily, eligible]) {
    for (const item of pool) {
      if (orderedSlugs.has(item.normalized.slug)) continue;
      orderedSlugs.add(item.normalized.slug);
      ordered.push(item);
    }
  }

  const selectedWrappers: typeof eligible = [];
  const capSkipped: typeof eligible = [];
  const categoryCounts = new Map<string, number>();
  for (const item of ordered) {
    const category = item.normalized.category;
    const count = category ? categoryCounts.get(category) ?? 0 : 0;
    if (category && count >= categoryDominanceCap) {
      capSkipped.push(item);
      continue;
    }
    selectedWrappers.push(item);
    if (category) categoryCounts.set(category, count + 1);
    if (selectedWrappers.length === maxCount) break;
  }

  let sparseCatalogueFill = false;
  if (selectedWrappers.length < maxCount && capSkipped.length > 0) {
    for (const item of capSkipped) {
      if (selectedWrappers.includes(item)) continue;
      selectedWrappers.push(item);
      sparseCatalogueFill = true;
      if (selectedWrappers.length === maxCount) break;
    }
  }

  const selectedDetails = selectedWrappers.map(({ normalized }) => {
    const rule = ruleForCandidate(normalized, options);
    return { id: normalized.id, slug: normalized.slug, rule, explanation: explanationForRule(rule) };
  });
  const selected = selectedWrappers.map(({ source, normalized }, index) =>
    sanitiseSelected(source, normalized, selectedDetails[index]!.rule)
  );
  const emptyReason = selected.length === 0
    ? "No eligible products are currently available to show."
    : null;
  const fallbackUsed = selectedRule === "catalogue_fallback" || selectedRule === "eligible_candidates";
  const fallbackReason = selectedRule === "catalogue_fallback"
    ? "No stronger supported relationship had enough eligible products; using the available catalogue."
    : selectedRule === "eligible_candidates"
      ? "No product context was supplied; using eligible catalogue candidates in source order."
      : null;
  const sparseCatalogueFillReason = sparseCatalogueFill
    ? "The category cap was relaxed only to fill remaining spaces from the eligible sparse catalogue."
    : eligible.length > 0 && eligible.length < maxCount
      ? "The eligible catalogue contains fewer products than the requested maximum."
      : null;

  return {
    inputCount: candidates.length,
    normalizedCount: normalizedInput.length,
    eligibleCount: eligible.length,
    ineligibleCount,
    duplicateCount,
    currentProductExcluded: currentProductExcludedCount > 0,
    currentProductExcludedCount,
    excludedCount: ineligibleCount + duplicateCount + currentProductExcludedCount,
    beforeCount: candidates.length,
    afterCount: selected.length,
    maxCount,
    categoryDominanceCap,
    categoryCapApplied: capSkipped.length > 0,
    sparseCatalogueFill,
    sparseCatalogueFillReason,
    selectedRule,
    fallbackUsed,
    fallbackReason,
    emptyReason,
    selectedDetails,
    selected,
  };
}

export function filterDisplayableRecommendations<T extends RecommendationCandidate>(
  items: T[],
  opts: RecommendationSelectionOptions & { limit?: number } = {},
): T[] {
  return previewRecommendationRules(items, {
    ...opts,
    maxCount: opts.limit ?? opts.maxCount,
  }).selected;
}

export function productToRecommendationItem(product: ProductPublicDto, reasonCode: string): RecommendationItemDto & {
  categoryName: string;
  subcategoryName: string;
  availability: ProductAvailability;
  imageAlt: string;
} {
  const safePrice = typeof product.retailPriceUgx === "number" && Number.isFinite(product.retailPriceUgx) && product.retailPriceUgx > 0
    ? product.retailPriceUgx
    : undefined;
  return {
    productId: product.id,
    slug: product.slug,
    name: product.name,
    imageUrl: isSafeImageUrl(product.primaryImageUrl) ? clean(product.primaryImageUrl) : undefined,
    imageAlt: `${product.name} product image`,
    price: safePrice,
    score: 0,
    reasonCodes: [],
    reasonCode,
    categoryName: product.categoryName,
    subcategoryName: getProductSubcategory(product),
    availability: product.availability,
  };
}

export function supportedRecommendationReason(reasonCode?: string): string | undefined {
  if (reasonCode === "SAME_SUBCATEGORY") return "Same product family";
  if (reasonCode === "SAME_CATEGORY" || reasonCode === "CATEGORY_FALLBACK") return "Same category";
  if (reasonCode === "COMPLEMENTARY_CATEGORY") return "Related catalogue family";
  if (reasonCode === "SAME_BRAND_OR_FAMILY") return "Same recorded family";
  if (["COMPATIBLE_ACCESSORY", "MATCHING_CONNECTOR", "SIMILAR_POWER"].includes(reasonCode ?? "")) {
    return "Related by product details";
  }
  // R7 (§27): the engine only emits POPULAR_NOW with a real evidence sample
  // (paid orders or a sufficient engagement window) since R3 — so the badge
  // is truthful by construction. Codes outside this allowlist render nothing.
  if (reasonCode === "POPULAR_NOW") return "Recently popular";
  if (reasonCode === "CART_ADDON") return "Useful add-on";
  return undefined;
}

export function shouldRenderRail<T>(items: T[], minItems = 1): boolean {
  return Array.isArray(items) && items.length >= minItems;
}

/**
 * A recommended item's own subcategory: inferred from the item's name and, when
 * the engine sends one, the item's own category. It never borrows the current
 * product's category, which put a power bank and a battery shown on a charger
 * page into the charger family.
 */
export function recommendedItemSubcategory(
  item: { name: string; categoryName?: string | null },
  taxonomy?: Parameters<typeof getProductSubcategory>[1],
): string {
  const own = typeof item.categoryName === "string" ? item.categoryName : undefined;
  return getProductSubcategory({ name: item.name, categoryName: own } as Parameters<typeof getProductSubcategory>[0], taxonomy);
}

/**
 * Brief A3 (2026-11-05): the "You may also need" rail said every suggestion was
 * "chosen from the compatibility records" while the engine filled it from a
 * name-based heuristic (a power bank page showed microSD cards). The wording now
 * follows the relationship each item actually has, read from the engine's own
 * candidate source and reason code:
 *
 * - verified_fit: a staff-recorded product-to-product fit (EXACT_PRODUCT_COMPATIBILITY).
 * - supplier_listed_fit: a fit the supplier lists that staff have not checked
 *   (reason SUPPLIER_LISTED_FIT; no engine source emits it today, the wording is ready).
 * - same_category_substitute: same category, an alternative rather than an add-on.
 * - complementary: inferred from product type (COMPLEMENTARY_HEURISTIC), not a checked fit.
 * - generic_fallback: bestseller or catalogue fallback; no relationship is claimed.
 */
export type RecommendationRelationship =
  | "verified_fit"
  | "supplier_listed_fit"
  | "same_category_substitute"
  | "complementary"
  | "generic_fallback";

export function recommendationRelationship(item: {
  candidateSource?: string | null;
  reasonCode?: string | null;
  reasonCodes?: readonly string[] | null;
}): RecommendationRelationship {
  const codes = new Set([item.reasonCode ?? "", ...(item.reasonCodes ?? [])].filter(Boolean));
  if (codes.has("SUPPLIER_LISTED_FIT")) return "supplier_listed_fit";
  if (item.candidateSource === "EXACT_PRODUCT_COMPATIBILITY") return "verified_fit";
  if (item.candidateSource === "COMPLEMENTARY_HEURISTIC") return "complementary";
  if (item.candidateSource === "SAME_CATEGORY_ATTRIBUTE_MATCH") return "same_category_substitute";
  if (codes.has("SAME_CATEGORY") || codes.has("SAME_SUBCATEGORY") || codes.has("CATEGORY_FALLBACK")) return "same_category_substitute";
  return "generic_fallback";
}

/** The small label on one card. A generic fallback claims nothing, so it gets none. */
export function recommendationRelationshipLabel(relationship: RecommendationRelationship): string | undefined {
  if (relationship === "verified_fit") return "Fit on record";
  if (relationship === "supplier_listed_fit") return "Supplier-listed fit";
  if (relationship === "same_category_substitute") return "Similar product";
  if (relationship === "complementary") return "Related accessory";
  return undefined;
}

export interface RecommendationRailHeading {
  title: string;
  subtitle: string;
}

/**
 * The rail's heading, from the relationships of the items actually shown.
 * null = nothing to show, so no rail (and no heading) renders.
 */
export function completeSetupHeading(
  items: ReadonlyArray<Parameters<typeof recommendationRelationship>[0]>,
): RecommendationRailHeading | null {
  if (items.length === 0) return null;
  const kinds = new Set(items.map(recommendationRelationship));
  if (kinds.size === 1) {
    const [only] = [...kinds];
    if (only === "verified_fit") return { title: "Fits this product", subtitle: "Our staff recorded each of these as a fit for this product. Read the fit note on each product page before you order." };
    if (only === "supplier_listed_fit") return { title: "Listed by the supplier as a fit", subtitle: "The supplier lists these as fitting. Our staff have not checked them yet." };
    if (only === "complementary") return { title: "Related accessories", subtitle: "Suggested by product type, not a checked fit. Check the fit on each product page before you order." };
    if (only === "same_category_substitute") return { title: "Similar products", subtitle: "Other products in the same category." };
    return { title: "More from the shop", subtitle: "Other products we sell. These are not matched to this product." };
  }
  return {
    title: "You may also need",
    subtitle: kinds.has("verified_fit")
      ? "Each card says why it is shown. Only cards marked \"Fit on record\" are recorded fits for this product."
      : "Each card says why it is shown. None of these is a checked fit for this product.",
  };
}
