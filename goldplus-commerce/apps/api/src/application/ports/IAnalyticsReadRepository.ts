/**
 * Read-side port for Commerce Analytics.
 *
 * Every method is a bounded aggregate: the web layer never downloads the order
 * ledger to compute summary metrics, and no method returns customer PII —
 * aggregation happens in PostgreSQL and only totals cross this boundary.
 */

export interface AnalyticsOrderAggregates {
  orders: number;
  paidOrders: number;
  paidOrderValueUgx: number;
  grossOrderValueUgx: number;
  discountValueUgx: number;
  deliveryFeeValueUgx: number;
  failedPayments: number;
  completedOrders: number;
  cancelledOrders: number;
}

export interface AnalyticsDailyBucket {
  /** Africa/Kampala calendar day, YYYY-MM-DD. */
  day: string;
  orders: number;
  paidOrders: number;
  paidOrderValueUgx: number;
}

export interface AnalyticsSearchSummary {
  totalSearches: number;
  zeroResultSearches: number;
  lastSignalAt: Date | null;
}

/** Newest record instants per source, for freshness reporting. */
export interface AnalyticsSourceRecency {
  lastOrderAt: Date | null;
  lastPaymentAttemptAt: Date | null;
  lastSearchSignalAt: Date | null;
}

export interface IAnalyticsReadRepository {
  /** Aggregates over orders created in [start, end] (UTC instants of Kampala days). */
  orderAggregates(start: Date, end: Date): Promise<AnalyticsOrderAggregates>;
  /** Daily buckets grouped by Africa/Kampala calendar day inside [start, end]. */
  dailyOrderBuckets(start: Date, end: Date): Promise<AnalyticsDailyBucket[]>;
  /** Point-in-time count of products at or below their reorder point. */
  lowStockCount(): Promise<number>;
  /** Lifetime search-demand aggregate (the source stores rolled-up signals). */
  searchDemandSummary(): Promise<AnalyticsSearchSummary>;
  sourceRecency(): Promise<AnalyticsSourceRecency>;
}
