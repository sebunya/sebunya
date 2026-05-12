import type {
  GetRecommendationsInput,
  RecommendationResponseDto,
  TrackRecommendationEventInput,
  ApiResponse,
} from "@goldplus/shared";
import { getAnonymousId } from "./anonymous-id";
import { apiBase } from "./api";

function toQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    query.set(key, String(value));
  }

  return query.toString();
}

export async function trackRecommendationEvent(
  input: Omit<TrackRecommendationEventInput, "anonymousId"> & { anonymousId?: string },
): Promise<void> {
  try {
    const anonymousId = input.anonymousId ?? getAnonymousId();
    // Fail early gracefully if no context identifier available.
    if (!anonymousId && !input.customerId) return;

    await fetch(`${apiBase}/recommendations/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
      body: JSON.stringify({
        ...input,
        anonymousId: input.anonymousId ?? anonymousId,
      }),
    });
  } catch {
    // Analytics events failing must NEVER inhibit rendering or UX.
  }
}

export async function trackProductView(productId: string, source = "product_page"): Promise<void> {
  await trackRecommendationEvent({
    eventType: "PRODUCT_VIEWED",
    productId,
    source,
    metadata: {
      pageType: "product",
    },
  });
}

export async function trackCategoryView(categoryId: string, source = "category_page"): Promise<void> {
  await trackRecommendationEvent({
    eventType: "CATEGORY_VIEWED",
    categoryId,
    source,
    metadata: {
      pageType: "category",
    },
  });
}

export async function trackRecommendationImpression(input: {
  placement: TrackRecommendationEventInput["placement"];
  productIds: string[];
  source?: string;
}): Promise<void> {
  for (const productId of input.productIds) {
    await trackRecommendationEvent({
      eventType: "RECOMMENDATION_VIEWED",
      placement: input.placement,
      recommendationProductId: productId,
      source: input.source ?? "recommendation_rail",
    });
  }
}

export async function trackRecommendationClick(input: {
  placement: TrackRecommendationEventInput["placement"];
  productId: string;
  source?: string;
}): Promise<void> {
  await trackRecommendationEvent({
    eventType: "RECOMMENDATION_CLICKED",
    placement: input.placement,
    recommendationProductId: input.productId,
    source: input.source ?? "recommendation_rail",
  });
}

export async function getRecommendations(
  input: GetRecommendationsInput,
): Promise<RecommendationResponseDto> {
  try {
    const anonymousId = input.anonymousId ?? getAnonymousId() ?? undefined;

    const query = toQuery({
      placement: input.placement,
      productId: input.productId,
      categoryId: input.categoryId,
      categorySlug: input.categorySlug,
      cartProductIds: input.cartProductIds?.join(","),
      anonymousId,
      limit: input.limit,
    });

    const response = await fetch(`${apiBase}/recommendations?${query}`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`API status ${response.status}`);
    }

    const json = (await response.json()) as ApiResponse<RecommendationResponseDto>;

    if (json?.success && json?.data) {
      return json.data;
    }
  } catch {
    // Empty set strategy on fail to prevent UI cascade failures.
  }

  return {
    placement: input.placement,
    items: [],
    generatedAt: new Date().toISOString(),
    strategy: "rule_based_v1",
  };
}

export interface RecentlyViewedLocalItem {
  productId: string;
  slug: string;
  name: string;
  imageUrl?: string;
  price?: number;
  currency?: string;
  viewedAt: string;
}

const RECENTLY_VIEWED_KEY = "goldplus_recently_viewed";

export function saveRecentlyViewedLocal(product: Omit<RecentlyViewedLocalItem, "viewedAt">): void {
  if (typeof window === "undefined") return;

  try {
    const existing = getRecentlyViewedLocal();
    const withoutCurrent = existing.filter((item) => item.productId !== product.productId);

    const next = [
      {
        ...product,
        viewedAt: new Date().toISOString(),
      },
      ...withoutCurrent,
    ].slice(0, 12);

    window.localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    // Silence failures on writing client cache.
  }
}

export function getRecentlyViewedLocal(): RecentlyViewedLocalItem[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
