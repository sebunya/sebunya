import { apiBase } from './api';

/**
 * Published reviews for a product, from the API's public read
 * (GET /commerce/reviews/products/:id). Every review is tied to a delivered
 * order line and passed a moderator; the aggregate exists only once at least
 * one review is published. Any failure is "no reviews", never an error on the
 * product page.
 */
export interface PublicReview { id: string; rating: number; title: string | null; body: string | null; verified: boolean; createdAt: string }
export interface ProductReviews { aggregate: { count: number; average: number; distribution: Record<string, number> } | null; reviews: PublicReview[] }

const EMPTY: ProductReviews = { aggregate: null, reviews: [] };

export async function getProductReviews(productId: string, timeoutMs = 1500): Promise<ProductReviews> {
  try {
    const res = await fetch(`${apiBase}/commerce/reviews/products/${encodeURIComponent(productId)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return EMPTY;
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: ProductReviews } | null;
    const d = json?.success ? json.data : null;
    if (!d) return EMPTY;
    const agg = d.aggregate && d.aggregate.count > 0 && typeof d.aggregate.average === 'number' ? d.aggregate : null;
    return { aggregate: agg, reviews: Array.isArray(d.reviews) ? d.reviews.filter((r) => Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5) : [] };
  } catch {
    return EMPTY;
  }
}

/** Google's AggregateRating, only with at least one published rating and stock to sell (never from zero). */
export function aggregateRatingNode(r: ProductReviews, inStock: boolean): Record<string, unknown> | null {
  if (!r.aggregate || r.aggregate.count < 1 || !inStock) return null;
  return { '@type': 'AggregateRating', ratingValue: r.aggregate.average, reviewCount: r.aggregate.count, bestRating: 5, worstRating: 1 };
}

export const starsText = (n: number) => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));
