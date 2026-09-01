import { salePriceUgx, effectiveFloorUgx } from '@goldplus/shared';

/**
 * Merchant Center product feed + feed-quality diagnostics.
 *
 * The feed is a Google Merchant RSS 2.0 XML document of the public catalogue —
 * live now, no credentials required (Merchant Center fetches the URL). Only
 * REAL product data appears:
 *  - included: isFeedEligible AND active AND approved AND imageUrl present AND
 *    priceUgx > 0
 *  - g:brand is 'GoldPlus' — the house brand; products carry no brand column.
 *  - g:mpn only when modelNumber is present. NO g:gtin — none exists and one is
 *    never invented.
 */

export interface FeedProduct {
  sku: string;
  slug: string;
  name: string;
  shortDescription: string;
  priceUgx: number;
  /** The product's own floor (Price A); null = not discountable. */
  floorPriceUgx?: number | null;
  stockStatus: string;
  imageUrl: string | null;
  modelNumber: string | null;
  isFeedEligible: boolean;
  active: boolean;
  approvalStatus: string;
}

export const STOREFRONT_BASE_URL = 'https://shopgoldplus.com';

/** The live site-wide campaign, when one is running, as the feed must state it. */
export interface FeedDiscount {
  percentBps: number;
  priceFloorUgx: number;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function isFeedIncluded(p: FeedProduct): boolean {
  return (
    p.isFeedEligible &&
    p.active &&
    p.approvalStatus === 'approved' &&
    typeof p.imageUrl === 'string' &&
    p.imageUrl.trim() !== '' &&
    p.priceUgx > 0
  );
}

const availability = (stockStatus: string): string =>
  stockStatus === 'in_stock' ? 'in stock' : 'out of stock';

export function buildMerchantFeedXml(
  products: FeedProduct[],
  baseUrl: string = STOREFRONT_BASE_URL,
  discount: FeedDiscount | null = null,
): string {
  const items = products.filter(isFeedIncluded).map((p) => {
    const link = `${baseUrl}/products/${encodeURIComponent(p.slug)}`;
    const campaignUgx = discount && discount.percentBps > 0
      ? salePriceUgx(p.priceUgx, discount.percentBps, effectiveFloorUgx(discount.priceFloorUgx, p.floorPriceUgx, p.priceUgx))
      : null;
    const saleUgx = campaignUgx !== null && campaignUgx < p.priceUgx ? campaignUgx : null;
    const lines = [
      '    <item>',
      `      <g:id>${escapeXml(p.sku)}</g:id>`,
      `      <title>${escapeXml(p.name)}</title>`,
      `      <description>${escapeXml(p.shortDescription)}</description>`,
      `      <link>${escapeXml(link)}</link>`,
      // Google requires an absolute image URL; stored URLs are site-relative paths.
      `      <g:image_link>${escapeXml(/^https?:\/\//i.test(p.imageUrl!) ? p.imageUrl! : `${baseUrl}${p.imageUrl!.startsWith('/') ? '' : '/'}${p.imageUrl!}`)}</g:image_link>`,
      `      <g:availability>${availability(p.stockStatus)}</g:availability>`,
      `      <g:price>${p.priceUgx} UGX</g:price>`,
      // Merchant Center wants the campaign price as g:sale_price alongside the
      // regular g:price. Publishing only the base price advertised a figure
      // higher than the storefront charges, which Google flags as a price
      // mismatch and which misleads the shopper who clicks through. Uses the
      // one shared formula, floor included, so the feed cannot drift from the
      // shop the way a hand-copied calculation did.
      ...(saleUgx !== null ? [`      <g:sale_price>${saleUgx} UGX</g:sale_price>`] : []),
      '      <g:condition>new</g:condition>',
      '      <g:brand>GoldPlus</g:brand>',
    ];
    if (p.modelNumber && p.modelNumber.trim() !== '') {
      lines.push(`      <g:mpn>${escapeXml(p.modelNumber)}</g:mpn>`);
    }
    lines.push('    </item>');
    return lines.join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '  <channel>',
    '    <title>GoldPlus Uganda</title>',
    `    <link>${escapeXml(baseUrl)}</link>`,
    '    <description>GoldPlus product feed</description>',
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

// ── Feed quality ────────────────────────────────────────────────────────────

export interface FeedQualityIssue {
  sku: string;
  slug: string;
  included: boolean;
  issues: string[];
}

export interface FeedQualityReport {
  totalProducts: number;
  includedInFeed: number;
  excludedFromFeed: number;
  issueCounts: Record<string, number>;
  products: FeedQualityIssue[];
}

export class FeedQualityUseCase {
  constructor(private readonly listProducts: () => Promise<FeedProduct[]>) {}

  async execute(): Promise<FeedQualityReport> {
    const products = await this.listProducts();
    const issueCounts: Record<string, number> = {};
    const rows: FeedQualityIssue[] = products.map((p) => {
      const issues: string[] = [];
      if (!p.isFeedEligible) issues.push('not_feed_eligible');
      if (!p.active) issues.push('inactive');
      if (p.approvalStatus !== 'approved') issues.push('not_approved');
      if (!p.imageUrl || p.imageUrl.trim() === '') issues.push('missing_image');
      if (!(p.priceUgx > 0)) issues.push('missing_price');
      if (!p.shortDescription || p.shortDescription.trim() === '') issues.push('missing_description');
      else if (p.shortDescription.trim().length < 50) issues.push('description_under_50_chars');
      if (!p.modelNumber || p.modelNumber.trim() === '') issues.push('missing_mpn');
      if (p.name.length > 150) issues.push('title_over_150_chars');
      for (const issue of issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
      return { sku: p.sku, slug: p.slug, included: isFeedIncluded(p), issues };
    });
    const included = rows.filter((r) => r.included).length;
    return {
      totalProducts: products.length,
      includedInFeed: included,
      excludedFromFeed: products.length - included,
      issueCounts,
      products: rows,
    };
  }
}
