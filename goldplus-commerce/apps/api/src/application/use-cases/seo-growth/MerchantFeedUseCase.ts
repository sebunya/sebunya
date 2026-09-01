import { salePriceUgx, effectiveFloorUgx } from '@goldplus/shared';
import { googleProductCategoryFor, productTypeFor } from '../../../domain/advertising/GoogleProductCategory';

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
  /** Our taxonomy, for g:product_type and the Google category mapping. */
  categoryName?: string | null;
  subcategory?: string | null;
  /** Preferred over shortDescription when the owner has written one. */
  longDescription?: string | null;
  /** Every gallery image in display order (primary first); extras become g:additional_image_link. */
  imageUrls?: string[];
  /** For the listing-quality report only. */
  id?: string;
  verifiedSpecCount?: number;
  /** Maker-verified specifications → g:product_detail / g:product_highlight. */
  verifiedSpecs?: Array<{ name: string; value: string; unit: string | null }>;
}

/**
 * "GoldPlus Cable GP-L01V" is brand + kind + code: nothing a shopper types.
 * A title earns its place when, brand and code removed, it still says something
 * measurable (a wattage, a capacity, a length, a connector, a version).
 */
export function titleIsCodeOnly(name: string, modelNumber: string | null, sku: string): boolean {
  let rest = name.replace(/^goldplus\s*/i, '');
  for (const code of [modelNumber ?? '', sku]) {
    const key = code.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (key) rest = rest.split(/\s+/).filter((w) => w.replace(/[^a-z0-9]/gi, '').toLowerCase() !== key).join(' ');
  }
  const words = rest.trim().split(/\s+/).filter(Boolean);
  const measurable = /\d+\s?(w|mah|gb|mb|tb|m|cm|mm|a|v|h|hz|khz)\b|usb-c|type-c|micro-usb|lightning|bluetooth\s?\d|\bpd\b|\bqc\d|\bgan\b|\btws\b/i;
  return words.length <= 3 && !measurable.test(rest);
}

export const STOREFRONT_BASE_URL = 'https://shopgoldplus.com';

/** The live site-wide campaign, when one is running, as the feed must state it. */
export interface FeedDiscount {
  percentBps: number;
  priceFloorUgx: number;
  /** The promotion's real window; the feed states it so Google shows the sale price only while the shop charges it. */
  saleStartIso?: string;
  saleEndIso?: string;
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
  stockStatus === 'in_stock' ? 'in stock' : stockStatus === 'pre_order' ? 'preorder' : 'out of stock';

const absolute = (baseUrl: string, url: string): string =>
  /^https?:\/\//i.test(url) ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;

/** Google's description limit is 5000 chars; the long description wins when the owner wrote one. */
export const feedDescription = (p: Pick<FeedProduct, 'shortDescription' | 'longDescription'>): string =>
  ((p.longDescription ?? '').trim() || p.shortDescription).trim().slice(0, 5000);

const MAX_ADDITIONAL_IMAGES = 10;
const MAX_HIGHLIGHTS = 10;
const MAX_PRODUCT_DETAILS = 30;

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
      `      <description>${escapeXml(feedDescription(p))}</description>`,
      `      <link>${escapeXml(link)}</link>`,
      // Google requires an absolute image URL; stored URLs are site-relative paths.
      `      <g:image_link>${escapeXml(absolute(baseUrl, p.imageUrl!))}</g:image_link>`,
      // The rest of the gallery, primary excluded, at most ten — Google shows them on the listing.
      ...(p.imageUrls ?? []).filter((u) => u && u !== p.imageUrl).slice(0, MAX_ADDITIONAL_IMAGES).map((u) => `      <g:additional_image_link>${escapeXml(absolute(baseUrl, u))}</g:additional_image_link>`),
      `      <g:availability>${availability(p.stockStatus)}</g:availability>`,
      `      <g:price>${p.priceUgx} UGX</g:price>`,
      // Merchant Center wants the campaign price as g:sale_price alongside the
      // regular g:price. Publishing only the base price advertised a figure
      // higher than the storefront charges, which Google flags as a price
      // mismatch and which misleads the shopper who clicks through. Uses the
      // one shared formula, floor included, so the feed cannot drift from the
      // shop the way a hand-copied calculation did.
      ...(saleUgx !== null ? [`      <g:sale_price>${saleUgx} UGX</g:sale_price>`] : []),
      // The sale window, so Google's sale price and the shop's expire together.
      ...(saleUgx !== null && discount?.saleStartIso && discount?.saleEndIso ? [`      <g:sale_price_effective_date>${escapeXml(`${discount.saleStartIso}/${discount.saleEndIso}`)}</g:sale_price_effective_date>`] : []),
      '      <g:condition>new</g:condition>',
      '      <g:brand>GoldPlus</g:brand>',
    ];
    if (p.modelNumber && p.modelNumber.trim() !== '') {
      lines.push(`      <g:mpn>${escapeXml(p.modelNumber)}</g:mpn>`);
    }
    // Where the product sits in Google's taxonomy (only when the mapping is
    // sure) and in ours (always, for grouping and bidding).
    const googleCategory = googleProductCategoryFor(p);
    if (googleCategory) lines.push(`      <g:google_product_category>${escapeXml(googleCategory)}</g:google_product_category>`);
    const productType = productTypeFor(p);
    if (productType) lines.push(`      <g:product_type>${escapeXml(productType)}</g:product_type>`);
    // Maker-verified specifications, exactly as recorded — never invented.
    const specs = (p.verifiedSpecs ?? []).slice(0, MAX_PRODUCT_DETAILS);
    for (const s of specs) {
      lines.push('      <g:product_detail>');
      lines.push(`        <g:attribute_name>${escapeXml(s.name)}</g:attribute_name>`);
      lines.push(`        <g:attribute_value>${escapeXml(s.unit ? `${s.value} ${s.unit}` : s.value)}</g:attribute_value>`);
      lines.push('      </g:product_detail>');
    }
    // The Features spec, one highlight per comma-separated feature (max 150 chars each).
    const features = specs.find((s) => s.name.toLowerCase() === 'features');
    for (const h of (features?.value ?? '').split(/,\s*/).map((v) => v.trim()).filter((v) => v.length > 0 && v.length <= 150).slice(0, MAX_HIGHLIGHTS)) {
      lines.push(`      <g:product_highlight>${escapeXml(h)}</g:product_highlight>`);
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
  id?: string;
  name?: string;
  categoryName?: string | null;
  hasImage?: boolean;
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
      // What still holds the listing back once it is in the feed.
      if (!googleProductCategoryFor(p)) issues.push('no_google_category');
      if (!(p.longDescription ?? '').trim()) issues.push('no_long_description');
      if ((p.imageUrls ?? []).length < 2) issues.push('single_image');
      if (titleIsCodeOnly(p.name, p.modelNumber, p.sku)) issues.push('title_is_code_only');
      if ((p.verifiedSpecCount ?? 0) === 0) issues.push('no_verified_specs');
      for (const issue of issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
      return { sku: p.sku, slug: p.slug, included: isFeedIncluded(p), issues, id: p.id, name: p.name, categoryName: p.categoryName ?? null, hasImage: !!(p.imageUrl && p.imageUrl.trim()) };
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
