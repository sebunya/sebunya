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

export interface AnalyticsPaymentAggregates {
  attempts: number;
  confirmed: number;
  failed: number;
  pending: number;
  /** Statuses the reconciliation vocabulary does not recognise. */
  unrecognised: number;
  callbackReceived: number;
  ipnReceived: number;
  /** Attempts whose order is already paid — reconciled evidence. */
  reconciled: number;
  byStatus: { status: string; count: number }[];
  byProvider: { provider: string; attempts: number; confirmed: number }[];
}

export interface AnalyticsFulfilmentExceptionRow {
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  ageHours: number;
  totalAmount: number;
}

export interface IAnalyticsReadRepository {
  /** Payment-attempt ledger aggregates for the period. */
  paymentAggregates(start: Date, end: Date): Promise<AnalyticsPaymentAggregates>;
  /**
   * Bounded exception drilldown: paid orders that have not reached a
   * processing state. Returns order numbers only — never customer fields.
   */
  paidNotProcessingOrders(start: Date, end: Date, limit: number, now: Date): Promise<AnalyticsFulfilmentExceptionRow[]>;
  /** Order counts grouped by a bounded dimension. */
  ordersByDimension(start: Date, end: Date, dimension: 'payment_status' | 'status'): Promise<{ value: string; orders: number; paidOrderValueUgx: number }[]>;
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
