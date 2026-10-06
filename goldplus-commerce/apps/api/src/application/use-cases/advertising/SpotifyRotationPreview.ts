import type { SpotifyRotationReader, FeaturedProductsStore } from '../../ports/SpotifyRotation';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { isFeedIncluded, feedAvailability, STOREFRONT_BASE_URL, type FeedProduct } from '../seo-growth/MerchantFeedUseCase';
import { planSpotifyRotation, type RotationPlan, type RotationProduct } from '../../../domain/advertising/SpotifyAdRotation';
import { priorLowestPrice, lastRestockedAt, firstPublishedAt } from '../../../domain/products/ProductMarketHistory';

export interface SpotifyRotationPreviewResult {
  plan: RotationPlan;
  /** When price and stock history starts; null = migration 0169 not applied. */
  historySince: string | null;
  /** The first day a "Price drop" can be proven (history start + 30 days). */
  priceDropsProvableFrom: string | null;
  productsConsidered: number;
  /** Every product the rotation may advertise, for the owner's featured picker. */
  candidates: Array<{ productId: string; name: string; priceUgx: number; featured: boolean }>;
  generatedAt: string;
}

export const SPOTIFY = 'spotify';
export const MAX_FEATURED = 10;

const abs = (u: string) => (/^https?:\/\//i.test(u) ? u : `${STOREFRONT_BASE_URL}${u.startsWith('/') ? '' : '/'}${u}`);

/**
 * What the Spotify rotation would do today, from live shop data. Read-only:
 * no Spotify call, no write, no spend. The products are exactly those the
 * Google/Meta catalogue feeds include (published, priced, photographed,
 * described), so Spotify never advertises what the feeds would not.
 */
export class SpotifyRotationPreviewUseCase {
  constructor(
    private readonly feedProducts: () => Promise<Array<FeedProduct & { id: string }>>,
    private readonly reader: SpotifyRotationReader,
    private readonly featured: FeaturedProductsStore,
    private readonly audit: Pick<CreateAuditLogUseCase, 'execute'> | null,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Replace the owner's featured products for Spotify. Only products the
   * rotation may advertise at all (in the catalogue feed), at most 10, each
   * once. Audited.
   */
  async setFeatured(actorId: string | null, productIds: unknown): Promise<{ ok: true; featured: string[] } | { ok: false; code: 'BAD_INPUT'; message: string }> {
    if (!Array.isArray(productIds) || productIds.some((x) => typeof x !== 'string')) return { ok: false, code: 'BAD_INPUT', message: 'productIds must be a list of product ids.' };
    const ids = [...new Set(productIds as string[])];
    if (ids.length > MAX_FEATURED) return { ok: false, code: 'BAD_INPUT', message: `At most ${MAX_FEATURED} featured products.` };
    const allowed = new Set((await this.feedProducts()).filter(isFeedIncluded).map((p) => p.id));
    const unknown = ids.filter((id) => !allowed.has(id));
    if (unknown.length) return { ok: false, code: 'BAD_INPUT', message: `Not in the catalogue feed, so not advertisable: ${unknown.join(', ')}.` };
    const before = await this.featured.list(SPOTIFY);
    await this.featured.replace(SPOTIFY, ids, actorId);
    await this.audit?.execute({ actorId, action: 'AD_FEATURED_PRODUCTS_SET', entity: 'ad_featured_products', entityId: SPOTIFY,
      oldState: { productIds: before }, newState: { productIds: ids } } as never);
    return { ok: true, featured: ids };
  }

  async preview(maxActive = 3): Promise<SpotifyRotationPreviewResult> {
    const now = this.clock();
    const feed = (await this.feedProducts()).filter(isFeedIncluded);
    const [f, featuredIds] = await Promise.all([this.reader.facts(feed.map((p) => p.id), now), this.featured.list(SPOTIFY)]);
    const featured = new Set(featuredIds);
    const products: RotationProduct[] = feed.map((p) => {
      const ev = f.events[p.id] ?? [];
      return {
        productId: p.id,
        name: p.name,
        priceUgx: p.priceUgx,
        priorLowestUgx30d: priorLowestPrice(ev),
        published: true,
        inStock: feedAvailability(p) === 'in stock',
        url: `${STOREFRONT_BASE_URL}/products/${encodeURIComponent(p.slug)}`,
        imageUrl: p.imageUrl ? abs(p.imageUrl) : null,
        // Every product here is in the feed, so published now. With no history
        // at all (before 0169) its creation time is the truthful stand-in.
        firstPublishedAt: ev.length ? firstPublishedAt(ev, f.createdAt[p.id] ?? null) : (f.createdAt[p.id] ?? null),
        restockedAt: lastRestockedAt(ev),
        orders30d: f.orders30d[p.id] ?? 0,
        featured: featured.has(p.id),
      };
    });
    // No Spotify Ads API connection yet (phase 3): the plan starts from no running ads.
    const plan = planSpotifyRotation({ products, ads: [], spotifyOrders30d: f.spotifyOrders30d, now, maxActive });
    return {
      plan,
      historySince: f.historySince?.toISOString() ?? null,
      priceDropsProvableFrom: f.historySince ? new Date(f.historySince.getTime() + 30 * 86_400_000).toISOString() : null,
      productsConsidered: products.length,
      candidates: products.map((p) => ({ productId: p.productId, name: p.name, priceUgx: p.priceUgx, featured: !!p.featured }))
        .sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name)),
      generatedAt: now.toISOString(),
    };
  }
}
