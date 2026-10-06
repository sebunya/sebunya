import type { MarketEvent } from '../../domain/products/ProductMarketHistory';

/** What the Spotify rotation needs from the database beyond the catalogue feed. Read-only. */
export interface SpotifyRotationReader {
  facts(productIds: string[], now: Date): Promise<{
    /** product_market_events (0169) per product: the last 90 days plus the event in force when they began. */
    events: Record<string, MarketEvent[]>;
    createdAt: Record<string, Date>;
    /** Paid orders containing the product, last 30 days. */
    orders30d: Record<string, number>;
    /** The same, only orders whose visit came from utm_source=spotify. */
    spotifyOrders30d: Record<string, number>;
    /** When history starts (the 0169 baseline); null = migration 0169 not applied yet. */
    historySince: Date | null;
  }>;
}
