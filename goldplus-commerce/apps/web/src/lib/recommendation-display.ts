import type { ProductAvailability, ProductPublicDto, RecommendationItemDto } from "@goldplus/shared";
import { getProductSubcategory } from "./product-discovery";

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
    ? `USh ${value.toLocaleString("en-UG")}`
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
    availability: normalized.availability,
    imageAlt: normalized.imageAlt,
    reasonCode: reasonCodeForRule(rule),
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
