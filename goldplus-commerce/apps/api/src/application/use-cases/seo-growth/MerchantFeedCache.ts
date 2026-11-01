/**
 * A cheap read that changes whenever anything the feed's availability is built
 * from changes (stock, reserved, stock status, pre-order), whichever path
 * wrote it: checkout reservations, dispatch consumption, admin adjustments,
 * imports and the product editor all write the same product columns.
 */
export interface FeedInventoryVersionPort {
  current(): Promise<string>;
}

export const MERCHANT_FEED_TTL_MS = 15 * 60 * 1000;

/**
 * The in-process Merchant Center feed cache (#10).
 *
 * The feed used to be rebuilt at most every 15 minutes, so a product that sold
 * out stayed "in stock" in the feed for up to a quarter of an hour (and one
 * restocked stayed "out of stock"). An inventory change now clears it: every
 * request reads the inventory version first and rebuilds when it moved. The
 * 15-minute ceiling stays for what the version does not cover (prices,
 * campaigns, copy). If the version read fails the cache falls back to the
 * ceiling alone, as before, rather than failing the feed.
 */
export class MerchantFeedCache {
  private cached: { xml: string; builtAt: number; inventoryVersion: string | null } | null = null;

  constructor(
    private readonly inventory: FeedInventoryVersionPort,
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs: number = MERCHANT_FEED_TTL_MS,
  ) {}

  /** Drop the cached feed; the next request rebuilds it. */
  invalidate(): void {
    this.cached = null;
  }

  async get(build: () => Promise<string>): Promise<string> {
    const now = this.now();
    let version: string | null = null;
    try {
      version = await this.inventory.current();
    } catch {
      version = null;
    }
    const cached = this.cached;
    const stale = !cached
      || now - cached.builtAt > this.ttlMs
      || (version !== null && version !== cached.inventoryVersion);
    if (!stale && cached) return cached.xml;
    const xml = await build();
    this.cached = { xml, builtAt: now, inventoryVersion: version };
    return xml;
  }
}
