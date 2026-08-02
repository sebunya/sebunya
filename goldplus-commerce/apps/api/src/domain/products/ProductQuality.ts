/**
 * Product data-quality scoring (§37A.32, items 45–50). Pure domain.
 *
 * Five transparent, deterministic sub-scores drive real decisions: which
 * products may enter a paid feed, which are SEO/AEO-ready, and which the
 * shopping assistant may ground on without inventing facts. Every score is
 * accompanied by the concrete `missing` signals, so "62/100" is never a mystery
 * — an operator sees exactly what to add. No score is fabricated: a product with
 * empty fields scores low and says why.
 */

export interface ProductQualityInput {
  productId: string;
  name: string;
  shortDescription: string;
  longDescription: string;
  hasImage: boolean;
  priceUgx: number;
  hasRetailPrice: boolean;
  categoryName: string | null;
  modelNumber: string;
  warrantyPeriod: string;
  /** Number of structured specification key/values. */
  specificationsCount: number;
}

export interface SubScore {
  score: number; // 0..100
  missing: string[];
}

export interface ProductQualityScore {
  productId: string;
  completeness: SubScore;
  feedEligibility: SubScore & { eligible: boolean };
  seoReadiness: SubScore;
  aeoReadiness: SubScore;
  assistantReadiness: SubScore;
  /** Simple average of the five sub-scores, for sorting worklists. */
  overall: number;
}

const nonEmpty = (s: string | null | undefined): boolean => !!s && s.trim().length > 0;
const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Weighted presence score: each signal contributes its weight when satisfied. */
function weighted(signals: Array<{ ok: boolean; weight: number; label: string }>): SubScore {
  const total = signals.reduce((s, x) => s + x.weight, 0) || 1;
  const earned = signals.reduce((s, x) => s + (x.ok ? x.weight : 0), 0);
  return {
    score: clampPct((earned / total) * 100),
    missing: signals.filter((x) => !x.ok).map((x) => x.label),
  };
}

export function scoreProductQuality(p: ProductQualityInput): ProductQualityScore {
  const hasPrice = p.hasRetailPrice && p.priceUgx > 0;
  const hasShort = nonEmpty(p.shortDescription) && p.shortDescription.trim().length >= 20;
  const hasLong = nonEmpty(p.longDescription) && p.longDescription.trim().length >= 100;
  const hasSpecs = p.specificationsCount >= 3;
  const hasCategory = nonEmpty(p.categoryName);
  const hasModel = nonEmpty(p.modelNumber);
  const hasWarranty = nonEmpty(p.warrantyPeriod);
  const hasName = nonEmpty(p.name);

  const completeness = weighted([
    { ok: hasName, weight: 15, label: 'name' },
    { ok: hasShort, weight: 10, label: 'short description (>=20 chars)' },
    { ok: hasLong, weight: 15, label: 'long description (>=100 chars)' },
    { ok: p.hasImage, weight: 15, label: 'image' },
    { ok: hasPrice, weight: 15, label: 'retail price (>0)' },
    { ok: hasCategory, weight: 10, label: 'category' },
    { ok: hasModel, weight: 8, label: 'model number' },
    { ok: hasWarranty, weight: 4, label: 'warranty' },
    { ok: hasSpecs, weight: 8, label: 'specifications (>=3)' },
  ]);

  // Feed eligibility: a paid product feed (Merchant Center / Meta) REQUIRES all
  // of these; eligible is all-or-nothing, the score shows how close.
  const feedSignals = [
    { ok: hasName, weight: 1, label: 'title' },
    { ok: hasLong || hasShort, weight: 1, label: 'description' },
    { ok: p.hasImage, weight: 1, label: 'image' },
    { ok: hasPrice, weight: 1, label: 'price' },
    { ok: hasCategory, weight: 1, label: 'category' },
    { ok: hasModel, weight: 1, label: 'MPN/model' },
  ];
  const feed = weighted(feedSignals);
  const feedEligibility = { ...feed, eligible: feedSignals.every((s) => s.ok) };

  const titleLenOk = p.name.trim().length >= 10 && p.name.trim().length <= 70;
  const seoReadiness = weighted([
    { ok: hasName, weight: 20, label: 'title' },
    { ok: titleLenOk, weight: 15, label: 'title length 10-70' },
    { ok: hasLong, weight: 25, label: 'indexable long description (>=100 chars)' },
    { ok: hasCategory, weight: 20, label: 'category for breadcrumb/taxonomy' },
    { ok: p.hasImage, weight: 10, label: 'image for rich result' },
    { ok: hasSpecs, weight: 10, label: 'specifications for structured data' },
  ]);

  // Answer-engine optimisation: answer engines quote STRUCTURED facts.
  const aeoReadiness = weighted([
    { ok: hasSpecs, weight: 35, label: 'structured specifications (>=3)' },
    { ok: hasLong, weight: 25, label: 'substantive description' },
    { ok: hasModel, weight: 15, label: 'model number for disambiguation' },
    { ok: hasWarranty, weight: 10, label: 'warranty fact' },
    { ok: hasCategory, weight: 15, label: 'category' },
  ]);

  // Assistant grounding: the shopping assistant must not invent facts, so it can
  // only speak confidently about a product with structured, priced, described data.
  const assistantReadiness = weighted([
    { ok: hasSpecs, weight: 30, label: 'specifications to ground answers' },
    { ok: hasLong || hasShort, weight: 25, label: 'description' },
    { ok: hasPrice, weight: 25, label: 'price to quote' },
    { ok: hasModel, weight: 10, label: 'model for compatibility' },
    { ok: hasCategory, weight: 10, label: 'category' },
  ]);

  const overall = clampPct(
    (completeness.score + feedEligibility.score + seoReadiness.score + aeoReadiness.score + assistantReadiness.score) / 5,
  );

  return { productId: p.productId, completeness, feedEligibility, seoReadiness, aeoReadiness, assistantReadiness, overall };
}
