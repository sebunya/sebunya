import type { MarketEvent } from '../../domain/products/ProductMarketHistory';

/** What the Spotify rotation needs from the database beyond the catalogue feed. Read-only. */
export interface SpotifyRotationReader {
  facts(productIds: string[], now: Date): Promise<{
    /** product_market_events (0169) per product: the last 90 days plus the event in force when they began. */
    events: Record<string, MarketEvent[]>;
    createdAt: Record<string, Date>;
    /** Sales containing the product, last 30 days: delivered or completed, or paid and not cancelled or failed. */
    orders30d: Record<string, number>;
    /** The same, only orders whose visit came from utm_source=spotify. */
    spotifyOrders30d: Record<string, number>;
    /** When history starts (the 0169 baseline); null = migration 0169 not applied yet. */
    historySince: Date | null;
  }>;
}

/** Products the owner chose to advertise, per ad platform (ad_featured_products, 0170). */
export interface FeaturedProductsStore {
  /** Empty when none are chosen, or when 0170 is not applied yet. */
  list(platform: string): Promise<string[]>;
  /** Replace the whole choice for the platform. */
  replace(platform: string, productIds: string[], actorId: string | null): Promise<void>;
}
