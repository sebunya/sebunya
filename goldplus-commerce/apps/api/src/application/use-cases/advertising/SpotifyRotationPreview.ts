import type { SpotifyRotationReader } from '../../ports/SpotifyRotation';
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
  generatedAt: string;
}

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
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async preview(maxActive = 3): Promise<SpotifyRotationPreviewResult> {
    const now = this.clock();
    const feed = (await this.feedProducts()).filter(isFeedIncluded);
    const f = await this.reader.facts(feed.map((p) => p.id), now);
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
      };
    });
    // No Spotify Ads API connection yet (phase 3): the plan starts from no running ads.
    const plan = planSpotifyRotation({ products, ads: [], spotifyOrders30d: f.spotifyOrders30d, now, maxActive });
    return {
      plan,
      historySince: f.historySince?.toISOString() ?? null,
      priceDropsProvableFrom: f.historySince ? new Date(f.historySince.getTime() + 30 * 86_400_000).toISOString() : null,
      productsConsidered: products.length,
      generatedAt: now.toISOString(),
    };
  }
}
