import { salePriceUgx, effectiveFloorUgx } from '@goldplus/shared';
import { googleProductCategoryFor, productTypeFor } from '../../../domain/advertising/GoogleProductCategory';
import {
  STOREFRONT_BASE_URL, feedAvailability, feedDescription, googleAvailability, isFeedIncluded,
  type FeedDiscount, type FeedProduct,
} from '../seo-growth/MerchantFeedUseCase';

/**
 * Product catalogue feeds for Meta (Commerce Manager data feed) and TikTok
 * (Catalog data feed), built from the SAME public catalogue and the SAME
 * inclusion rules as the Google Merchant feed (MerchantFeedUseCase):
 *  - only products the Google feed would include (eligible, active, approved,
 *    priced, described, with a real photo; sample frames are never in the
 *    image list, see feedProducts);
 *  - the public price only: never a dealer price, a supplier cost or a floor;
 *  - availability from stock minus reservations, stated as a word, never a
 *    number of units (no quantity_to_sell_on_facebook, no inventory column).
 * Field names, value formats and limits follow each platform's published spec
 * (docs/advertising/README.md, "Catalogue feeds").
 */

/** RFC 4180 cell: quoted when it holds a comma, quote or line break; control characters dropped. */
export function feedCsvCell(v: unknown): string {
  const s = String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\r?\n|\r/g, ' ');
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const absolute = (baseUrl: string, url: string): string => (/^https?:\/\//i.test(url) ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

function campaignSale(p: FeedProduct, discount: FeedDiscount | null): number | null {
  if (!discount || discount.percentBps <= 0) return null;
  const sale = salePriceUgx(p.priceUgx, discount.percentBps, effectiveFloorUgx(discount.priceFloorUgx, p.floorPriceUgx, p.priceUgx));
  return sale < p.priceUgx ? sale : null;
}

export const META_FEED_COLUMNS = [
  'id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand',
  'additional_image_link', 'sale_price', 'sale_price_effective_date', 'google_product_category', 'product_type', 'mpn',
] as const;

/**
 * Meta catalogue CSV. Meta's availability here is "in stock" or "out of
 * stock": a pre-order without a date goes as out of stock, exactly as the
 * Google feed sends it. The sale price is stated only with its real window,
 * so Meta stops showing it when the shop stops charging it.
 */
export function buildMetaCatalogueCsv(products: FeedProduct[], baseUrl: string = STOREFRONT_BASE_URL, discount: FeedDiscount | null = null): string {
  const lines = [META_FEED_COLUMNS.join(',')];
  for (const p of products.filter(isFeedIncluded)) {
    const avail = googleAvailability(p).availability === 'in stock' ? 'in stock' : 'out of stock';
    const sale = campaignSale(p, discount);
    const window = sale !== null && discount?.saleStartIso && discount?.saleEndIso ? `${discount.saleStartIso}/${discount.saleEndIso}` : '';
    const extra = (p.imageUrls ?? []).filter((u) => u && u !== p.imageUrl).slice(0, 20).map((u) => absolute(baseUrl, u));
    const row: Record<(typeof META_FEED_COLUMNS)[number], string> = {
      id: clip(p.sku, 100),
      title: clip(p.name, 200),
      description: clip(feedDescription(p), 9999),
      availability: avail,
      condition: 'new',
      price: `${p.priceUgx} UGX`,
      link: `${baseUrl}/products/${encodeURIComponent(p.slug)}`,
      image_link: absolute(baseUrl, p.imageUrl!),
      brand: 'GoldPlus',
      additional_image_link: extra.join(','),
      // A sale price without its window would outlive the sale: stated only with it.
      sale_price: sale !== null && window ? `${sale} UGX` : '',
      sale_price_effective_date: sale !== null ? window : '',
      google_product_category: googleProductCategoryFor(p) ?? '',
      product_type: clip(productTypeFor(p) ?? '', 750),
      mpn: clip((p.modelNumber ?? '').trim(), 100),
    };
    lines.push(META_FEED_COLUMNS.map((c) => feedCsvCell(row[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export const TIKTOK_FEED_COLUMNS = [
  'sku_id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand',
  'additional_image_link', 'google_product_category', 'product_type', 'mpn',
] as const;

/**
 * TikTok catalogue CSV (the nine required fields plus images, categories and
 * MPN). TikTok accepts "preorder", so a pre-order is stated as one. No sale
 * price: TikTok's field list has no effective-date field to end it with, and a
 * sale price that outlives the sale would advertise a price the shop no
 * longer charges. The regular price is always true.
 */
export function buildTikTokCatalogueCsv(products: FeedProduct[], baseUrl: string = STOREFRONT_BASE_URL): string {
  const lines = [TIKTOK_FEED_COLUMNS.join(',')];
  for (const p of products.filter(isFeedIncluded)) {
    const extra = (p.imageUrls ?? []).filter((u) => u && u !== p.imageUrl).slice(0, 10).map((u) => absolute(baseUrl, u));
    const row: Record<(typeof TIKTOK_FEED_COLUMNS)[number], string> = {
      sku_id: clip(p.sku, 100),
      title: clip(p.name, 150),
      description: clip(feedDescription(p), 5000),
      availability: feedAvailability(p),
      condition: 'new',
      price: `${p.priceUgx} UGX`,
      link: `${baseUrl}/products/${encodeURIComponent(p.slug)}`,
      image_link: absolute(baseUrl, p.imageUrl!),
      brand: 'GoldPlus',
      additional_image_link: extra.join(','),
      google_product_category: googleProductCategoryFor(p) ?? '',
      product_type: productTypeFor(p) ?? '',
      mpn: (p.modelNumber ?? '').trim(),
    };
    lines.push(TIKTOK_FEED_COLUMNS.map((c) => feedCsvCell(row[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export interface CatalogueFeedSource {
  products(): Promise<FeedProduct[]>;
  discount(): Promise<FeedDiscount | null>;
}

export class CatalogueFeedUseCases {
  private cache = new Map<string, { at: number; body: string }>();
  constructor(private readonly source: CatalogueFeedSource, private readonly ttlMs = 15 * 60_000, private readonly now: () => number = () => Date.now()) {}

  private async cached(key: string, build: () => Promise<string>): Promise<string> {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.body;
    const body = await build();
    this.cache.set(key, { at: this.now(), body });
    return body;
  }

  meta() { return this.cached('meta', async () => buildMetaCatalogueCsv(await this.source.products(), STOREFRONT_BASE_URL, await this.source.discount())); }
  tiktok() { return this.cached('tiktok', async () => buildTikTokCatalogueCsv(await this.source.products(), STOREFRONT_BASE_URL)); }

  /** How many products each feed carries (the checklist's "Feed ready" line). */
  async included(): Promise<number> { return (await this.source.products()).filter(isFeedIncluded).length; }
}
