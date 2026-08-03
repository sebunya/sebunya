/**
 * Review domain (U3). Pure — no DB, no adapters.
 */

// ---- PII detection (AC5) -------------------------------------------------
// A review that leaks a phone number or an email is flagged, never auto-published
// and never silently deleted — the content is preserved for a moderator.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// Ugandan / international phone shapes: 9+ digits, optional +, spaces, dashes.
const PHONE_RE = /(?:\+?\d[\s-]?){9,}/;

export interface ReviewPiiResult {
  hasPii: boolean;
  kinds: Array<'email' | 'phone'>;
}

export function detectReviewPii(...parts: Array<string | null | undefined>): ReviewPiiResult {
  const text = parts.filter(Boolean).join(' ');
  const kinds: Array<'email' | 'phone'> = [];
  if (EMAIL_RE.test(text)) kinds.push('email');
  // Strip the email local part so an email's digits don't double-count as a phone,
  // then test for a phone-like run.
  if (PHONE_RE.test(text.replace(EMAIL_RE, ' '))) kinds.push('phone');
  return { hasPii: kinds.length > 0, kinds };
}

// ---- Rating aggregate (AC2/AC4) -----------------------------------------
export interface RatingAggregate {
  count: number;
  sum: number;
  average: number | null;
  distribution: Record<string, number>; // "1".."5"
}

/** Compute the aggregate from the ratings of PUBLISHED reviews. Never computed on
 * read from raw rows in the hot path — persisted and recomputed on publish state
 * changes — but the maths lives here so it is unit-testable and deterministic. */
export function computeRatingAggregate(publishedRatings: number[]): RatingAggregate {
  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let sum = 0;
  for (const r of publishedRatings) {
    if (r >= 1 && r <= 5) {
      distribution[String(r)]++;
      sum += r;
    }
  }
  const count = publishedRatings.length;
  const average = count === 0 ? null : Math.round((sum / count) * 100) / 100;
  return { count, sum, average, distribution };
}

// ---- AggregateRating structured data (AC3) ------------------------------
export interface AggregateRatingJsonLd {
  '@type': 'AggregateRating';
  ratingValue: number;
  reviewCount: number;
  bestRating: 5;
  worstRating: 1;
}

/**
 * Emit AggregateRating JSON-LD ONLY when there is at least one published rating
 * AND the product is in stock. Returns null otherwise — a page must not advertise
 * a rating for a product it cannot sell, and must not fabricate a rating from zero
 * reviews.
 */
export function aggregateRatingJsonLd(agg: RatingAggregate, inStock: boolean): AggregateRatingJsonLd | null {
  if (agg.count < 1 || agg.average == null || !inStock) return null;
  return {
    '@type': 'AggregateRating',
    ratingValue: agg.average,
    reviewCount: agg.count,
    bestRating: 5,
    worstRating: 1,
  };
}
