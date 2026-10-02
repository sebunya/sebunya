import { salePriceUgx, effectiveFloorUgx, jpegRendition } from '@goldplus/shared';
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
  // eslint-disable-next-line no-control-regex -- deliberately strips control characters
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
  'additional_image_link', 'sale_price', 'sale_price_effective_date', 'google_product_category', 'product_type', 'mpn', 'custom_label_0',
] as const;

/**
 * The ID Meta knows a product by. It MUST be the id the shop's events name in
 * `content_ids` (the product id: AdPlatforms.metaCustomData), or Meta cannot
 * tie a view, a basket or a purchase to the catalogue item, and catalogue
 * adverts have nothing to retarget with. Until 2026-10-01 the feed gave the
 * SKU while every event gave the product id: no event matched any item.
 */
export const metaCatalogueId = (p: FeedProduct): string => clip(p.id ?? p.sku, 100);

/**
 * Meta catalogue CSV. Images are the JPEG renditions: Meta's catalogue takes
 * JPEG and PNG only, and the shop's display rendition is WebP. The SKU, which
 * staff recognise a product by, travels in custom_label_0. Meta's availability here is "in stock" or "out of
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
    const extra = (p.imageUrls ?? []).filter((u) => u && u !== p.imageUrl).slice(0, 20).map((u) => jpegRendition(absolute(baseUrl, u)));
    const row: Record<(typeof META_FEED_COLUMNS)[number], string> = {
      id: metaCatalogueId(p),
      title: clip(p.name, 200),
      description: clip(feedDescription(p), 9999),
      availability: avail,
      condition: 'new',
      price: `${p.priceUgx} UGX`,
      link: `${baseUrl}/products/${encodeURIComponent(p.slug)}`,
      image_link: jpegRendition(absolute(baseUrl, p.imageUrl!)),
      brand: 'GoldPlus',
      additional_image_link: extra.join(','),
      // A sale price without its window would outlive the sale: stated only with it.
      sale_price: sale !== null && window ? `${sale} UGX` : '',
      sale_price_effective_date: sale !== null ? window : '',
      google_product_category: googleProductCategoryFor(p) ?? '',
      product_type: clip(productTypeFor(p) ?? '', 750),
      mpn: clip((p.modelNumber ?? '').trim(), 100),
      custom_label_0: clip(p.sku, 100),
    };
    lines.push(META_FEED_COLUMNS.map((c) => feedCsvCell(row[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export const TIKTOK_FEED_COLUMNS = [
  'sku_id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand',
  'additional_image_link', 'google_product_category', 'product_type', 'mpn', 'custom_label_0',
] as const;

/**
 * TikTok catalogue CSV (the nine required fields plus images, categories and
 * MPN). `sku_id` is the product id the events name, and pictures are the JPEG
 * renditions (TikTok's catalogue takes JPG and PNG), as for Meta's feed. TikTok accepts "preorder", so a pre-order is stated as one. No sale
 * price: TikTok's field list has no effective-date field to end it with, and a
 * sale price that outlives the sale would advertise a price the shop no
 * longer charges. The regular price is always true.
 */
/**
 * A feed price as TikTok can take it. TikTok's catalogue currencies (the same
 * list as its events) have no Uganda shilling, so with the owner's rate
 * (shillings per US dollar, the TikTok destination's `ugxPerUsd`) the price is
 * stated in US dollars; the catalogue's default currency must then be USD.
 * Without a rate it stays in shillings, which TikTok will not accept: the
 * price is not converted at a rate nobody chose.
 */
export function tiktokFeedPrice(priceUgx: number, ugxPerUsd?: number | null): string {
  if (!ugxPerUsd || !Number.isFinite(ugxPerUsd) || ugxPerUsd < 100) return `${priceUgx} UGX`;
  return `${(Math.round((priceUgx / ugxPerUsd) * 100) / 100).toFixed(2)} USD`;
}

export function buildTikTokCatalogueCsv(products: FeedProduct[], baseUrl: string = STOREFRONT_BASE_URL, ugxPerUsd?: number | null): string {
  const lines = [TIKTOK_FEED_COLUMNS.join(',')];
  for (const p of products.filter(isFeedIncluded)) {
    const extra = (p.imageUrls ?? []).filter((u) => u && u !== p.imageUrl).slice(0, 10).map((u) => jpegRendition(absolute(baseUrl, u)));
    const row: Record<(typeof TIKTOK_FEED_COLUMNS)[number], string> = {
      // The id every event names in contents[].content_id (the product id), so a
      // view or a sale can be tied to the catalogue item; the SKU is in custom_label_0.
      sku_id: metaCatalogueId(p),
      title: clip(p.name, 150),
      description: clip(feedDescription(p), 5000),
      availability: feedAvailability(p),
      condition: 'new',
      price: tiktokFeedPrice(p.priceUgx, ugxPerUsd),
      link: `${baseUrl}/products/${encodeURIComponent(p.slug)}`,
      image_link: jpegRendition(absolute(baseUrl, p.imageUrl!)),
      brand: 'GoldPlus',
      additional_image_link: extra.join(','),
      google_product_category: googleProductCategoryFor(p) ?? '',
      product_type: productTypeFor(p) ?? '',
      mpn: (p.modelNumber ?? '').trim(),
      custom_label_0: clip(p.sku, 100),
    };
    lines.push(TIKTOK_FEED_COLUMNS.map((c) => feedCsvCell(row[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export interface CatalogueFeedSource {
  products(): Promise<FeedProduct[]>;
  discount(): Promise<FeedDiscount | null>;
  /** The owner's shillings-per-dollar rate for TikTok, when one is saved. */
  tiktokUgxPerUsd?(): Promise<number | null>;
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
  tiktok() { return this.cached('tiktok', async () => buildTikTokCatalogueCsv(await this.source.products(), STOREFRONT_BASE_URL, (await this.source.tiktokUgxPerUsd?.().catch(() => null)) ?? null)); }

  /** How many products each feed carries (the checklist's "Feed ready" line). */
  async included(): Promise<number> { return (await this.source.products()).filter(isFeedIncluded).length; }
}
