/**
 * Canonical Commerce Analytics metric catalogue.
 *
 * ONE source of truth for what every analytics metric means. API responses,
 * UI tooltips, quality validation, exports and tests all read this catalogue;
 * no page or route may embed its own formula for a catalogued metric.
 *
 * Honesty rules encoded here:
 *  - polarity is explicit — an increase is not always good, and the UI must
 *    never colour a change without consulting it;
 *  - every rate declares its exact denominator;
 *  - minimumSample states the volume below which the metric must be reported
 *    as INSUFFICIENT_EVIDENCE rather than as a confident percentage;
 *  - "paid order value" is an operational metric and is never labelled
 *    revenue: the accounting source of recognised revenue does not exist in
 *    this system.
 */

export const ANALYTICS_SOURCE_KEYS = [
  'orders',
  'payments',
  'fulfilment',
  'recommendations',
  'search',
  'inventory',
  'decision_intelligence',
  'measurement_summary',
  'measurement_warnings',
] as const;
export type AnalyticsSourceKey = (typeof ANALYTICS_SOURCE_KEYS)[number];

/**
 * Direction semantics for a change in the metric.
 *  INCREASE_IS_GOOD — up and to the right is desirable (orders, paid value).
 *  INCREASE_IS_BAD  — an increase is a warning (failure rate, zero-result rate).
 *  DIRECTIONLESS    — a change is context-dependent and must not be coloured
 *                     as inherently good or bad (discount value).
 */
export type MetricPolarity = 'INCREASE_IS_GOOD' | 'INCREASE_IS_BAD' | 'DIRECTIONLESS';

export type MetricUnit = 'count' | 'UGX' | 'rate';

export interface MetricDefinition {
  key: string;
  label: string;
  /** Operator-facing business definition. Precise, not marketing. */
  definition: string;
  /** The exact formula in words. */
  formula: string;
  unit: MetricUnit;
  /** The record grain the metric is computed over. */
  grain: 'order' | 'payment_attempt' | 'search_event' | 'recommendation_event' | 'product';
  numerator: string;
  /** Exact denominator for rates; 'NONE' for counts and sums. */
  denominator: string;
  inclusions: string;
  exclusions: string;
  /** Which analytics source feeds this metric. */
  source: AnalyticsSourceKey;
  /** The timestamp field that assigns a record to a Kampala day. */
  timeField: string;
  polarity: MetricPolarity;
  /**
   * Below this denominator volume a rate is INSUFFICIENT_EVIDENCE, never a
   * confident percentage. 0 for counts and sums.
   */
  minimumSample: number;
  /** Longest acceptable source age before the metric is flagged STALE. */
  freshnessExpectationMinutes: number;
  owner: string;
  /** Admin route that shows the underlying records. */
  drilldownRoute: string;
}

export const ANALYTICS_METRIC_CATALOGUE: readonly MetricDefinition[] = [
  {
    key: 'orders',
    label: 'Orders',
    definition: 'Orders created in the selected period.',
    formula: 'count(orders where created_at within period)',
    unit: 'count',
    grain: 'order',
    numerator: 'orders created in the period',
    denominator: 'NONE',
    inclusions: 'every order record regardless of payment or fulfilment state',
    exclusions: 'none',
    source: 'orders',
    timeField: 'orders.created_at',
    polarity: 'INCREASE_IS_GOOD',
    minimumSample: 0,
    freshnessExpectationMinutes: 60,
    owner: 'commerce-operations',
    drilldownRoute: '/admin/orders',
  },
  {
    key: 'paid_orders',
    label: 'Paid orders',
    definition: 'Orders created in the period whose payment status is paid.',
    formula: "count(orders where created_at within period and payment_status = 'paid')",
    unit: 'count',
    grain: 'order',
    numerator: 'orders with payment_status paid',
    denominator: 'NONE',
    inclusions: 'orders whose payment reached the paid state',
    exclusions: 'unpaid, pending, failed, rejected and cancelled payment states',
    source: 'orders',
    timeField: 'orders.created_at',
    polarity: 'INCREASE_IS_GOOD',
    minimumSample: 0,
    freshnessExpectationMinutes: 60,
    owner: 'commerce-operations',
    drilldownRoute: '/admin/orders?paymentStatus=paid',
  },
  {
    key: 'paid_order_value',
    label: 'Paid order value',
    definition:
      'Sum of order totals for paid orders. This is operational paid order value, not recognised accounting revenue: no accounting source exists in this system.',
    formula: "sum(orders.total_amount where payment_status = 'paid' and created_at within period)",
    unit: 'UGX',
    grain: 'order',
    numerator: 'total_amount of paid orders',
    denominator: 'NONE',
    inclusions: 'delivery fees and taxes as captured in order totals',
    exclusions: 'orders not in the paid state; refunds are not modelled as a source and are not netted',
    source: 'orders',
    timeField: 'orders.created_at',
    polarity: 'INCREASE_IS_GOOD',
    minimumSample: 0,
    freshnessExpectationMinutes: 60,
    owner: 'commerce-operations',
    drilldownRoute: '/admin/orders?paymentStatus=paid',
  },
  {
    key: 'average_paid_order_value',
    label: 'Average paid order value',
    definition: 'Paid order value divided by paid order count.',
    formula: 'paid_order_value / paid_orders',
    unit: 'UGX',
    grain: 'order',
    numerator: 'paid order value',
    denominator: 'paid orders in the period',
    inclusions: 'paid orders only',
    exclusions: 'periods with no paid orders report no value, never zero',
    source: 'orders',
    timeField: 'orders.created_at',
    polarity: 'INCREASE_IS_GOOD',
    minimumSample: 1,
    freshnessExpectationMinutes: 60,
    owner: 'commerce-operations',
    drilldownRoute: '/admin/orders?paymentStatus=paid',
  },
  {
    key: 'gross_order_value',
    label: 'Gross order value',
    definition: 'Sum of order totals for every order created in the period, regardless of payment state.',
    formula: 'sum(orders.total_amount where created_at within period)',
    unit: 'UGX',
    grain: 'order',
    numerator: 'total_amount of all orders',
    denominator: 'NONE',
    inclusions: 'all payment states',
    exclusions: 'none',
    source: 'orders',
    timeField: 'orders.created_at',
    polarity: 'DIRECTIONLESS',
    minimumSample: 0,
    freshnessExpectationMinutes: 60,
    owner: 'commerce-operations',
    drilldownRoute: '/admin/orders',
  },
  {
    key: 'discount_value',
    label: 'Discount value',
    definition:
      'Pricing discount total recorded on orders created in the period. A change is context-dependent: rising discounts may be a planned promotion or margin leakage.',
    formula: 'sum(orders.pricing_discount_total where created_at within period)',
    unit: 'UGX',
    grain: 'order',
    numerator: 'pricing_discount_total of all orders',
    denominator: 'NONE',
    inclusions: 'all orders, paid or not',
    exclusions: 'none',
    source: 'orders',
    timeField: 'orders.created_at',
    polarity: 'DIRECTIONLESS',
    minimumSample: 0,
    freshnessExpectationMinutes: 60,
    owner: 'pricing',
    drilldownRoute: '/admin/pricing',
  },
  {
    key: 'delivery_fee_value',
    label: 'Delivery fee value',
    definition: 'Delivery fees recorded on orders created in the period.',
    formula: 'sum(orders.delivery_fee where created_at within period)',
    unit: 'UGX',
    grain: 'order',
    numerator: 'delivery_fee of all orders',
    denominator: 'NONE',
    inclusions: 'all orders, paid or not',
    exclusions: 'none',
    source: 'orders',
    timeField: 'orders.created_at',
    polarity: 'DIRECTIONLESS',
    minimumSample: 0,
    freshnessExpectationMinutes: 60,
    owner: 'commerce-operations',
    drilldownRoute: '/admin/orders',
  },
  {
    key: 'payment_success_rate',
    label: 'Payment success rate',
    definition:
      'Paid orders divided by all orders created in the period. The denominator is order records, not payment attempts; attempt-level success is reported separately by payment intelligence.',
    formula: 'paid_orders / orders',
    unit: 'rate',
    grain: 'order',
    numerator: 'orders with payment_status paid',
    denominator: 'all orders created in the period',
    inclusions: 'every order regardless of payment progress',
    exclusions: 'none',
    source: 'orders',
    timeField: 'orders.created_at',
    polarity: 'INCREASE_IS_GOOD',
    minimumSample: 5,
    freshnessExpectationMinutes: 60,
    owner: 'payments',
    drilldownRoute: '/admin/measurement/payments',
  },
  {
    key: 'payment_failure_rate',
    label: 'Payment failure rate',
    definition: 'Orders whose payment state is failed, rejected or cancelled, divided by all orders created in the period.',
    formula: "count(orders where payment_status in ('failed','rejected','cancelled')) / orders",
    unit: 'rate',
    grain: 'order',
    numerator: 'orders in a terminal failed payment state',
    denominator: 'all orders created in the period',
    inclusions: 'failed, rejected and cancelled payment states',
    exclusions: 'pending and unpaid states are not failures',
    source: 'orders',
    timeField: 'orders.created_at',
    polarity: 'INCREASE_IS_BAD',
    minimumSample: 5,
    freshnessExpectationMinutes: 60,
    owner: 'payments',
    drilldownRoute: '/admin/measurement/payments',
  },
  {
    key: 'order_cancellation_rate',
    label: 'Order cancellation rate',
    definition: 'Cancelled orders divided by all orders created in the period.',
    formula: "count(orders where status = 'cancelled') / orders",
    unit: 'rate',
    grain: 'order',
    numerator: 'orders whose order status is cancelled',
    denominator: 'all orders created in the period',
    inclusions: 'cancellations from any cause',
    exclusions: 'none',
    source: 'fulfilment',
    timeField: 'orders.created_at',
    polarity: 'INCREASE_IS_BAD',
    minimumSample: 5,
    freshnessExpectationMinutes: 60,
    owner: 'commerce-operations',
    drilldownRoute: '/admin/orders?status=cancelled',
  },
  {
    key: 'fulfilment_completion_rate',
    label: 'Fulfilment completion rate',
    definition:
      'Completed orders divided by all orders created in the period. Recent periods understate this rate because young orders have not had time to complete.',
    formula: "count(orders where status = 'completed') / orders",
    unit: 'rate',
    grain: 'order',
    numerator: 'orders whose order status is completed',
    denominator: 'all orders created in the period',
    inclusions: 'orders completed at any time, bucketed by creation day',
    exclusions: 'none',
    source: 'fulfilment',
    timeField: 'orders.created_at',
    polarity: 'INCREASE_IS_GOOD',
    minimumSample: 5,
    freshnessExpectationMinutes: 60,
    owner: 'fulfilment',
    drilldownRoute: '/admin/fulfilment',
  },
  {
    key: 'search_zero_result_rate',
    label: 'Search zero-result rate',
    definition: 'Tracked searches returning no products divided by total tracked searches.',
    formula: 'zero_result_searches / total_tracked_searches',
    unit: 'rate',
    grain: 'search_event',
    numerator: 'tracked searches with zero results',
    denominator: 'all tracked searches in the source window',
    inclusions: 'searches captured by the demand-capture pipeline',
    exclusions: 'searches from sessions that opted out of measurement are never captured',
    source: 'search',
    timeField: 'search_demand_signals.last_seen_at',
    polarity: 'INCREASE_IS_BAD',
    minimumSample: 10,
    freshnessExpectationMinutes: 24 * 60,
    owner: 'search',
    drilldownRoute: '/admin/demand',
  },
  {
    key: 'recommendation_ctr',
    label: 'Recommendation click-through rate',
    definition: 'Recommendation clicks divided by recommendation impressions.',
    formula: 'recommendation_clicks / recommendation_impressions',
    unit: 'rate',
    grain: 'recommendation_event',
    numerator: 'recommendation clicks',
    denominator: 'recommendation impressions',
    inclusions: 'events captured by the recommendation analytics pipeline',
    exclusions: 'nothing is inferred for surfaces without impression tracking',
    source: 'recommendations',
    timeField: 'recommendation event occurred_at',
    polarity: 'INCREASE_IS_GOOD',
    minimumSample: 100,
    freshnessExpectationMinutes: 24 * 60,
    owner: 'recommendations',
    drilldownRoute: '/admin/recommendations/analytics',
  },
  {
    key: 'recommendation_add_to_cart_rate',
    label: 'Recommendation add-to-cart rate',
    definition: 'Recommendation-attributed add-to-cart events divided by recommendation clicks.',
    formula: 'recommendation_add_to_cart / recommendation_clicks',
    unit: 'rate',
    grain: 'recommendation_event',
    numerator: 'add-to-cart events attributed to a recommendation click',
    denominator: 'recommendation clicks',
    inclusions: 'attributed add-to-cart events only',
    exclusions: 'organic add-to-cart is never counted here',
    source: 'recommendations',
    timeField: 'recommendation event occurred_at',
    polarity: 'INCREASE_IS_GOOD',
    minimumSample: 30,
    freshnessExpectationMinutes: 24 * 60,
    owner: 'recommendations',
    drilldownRoute: '/admin/recommendations/analytics',
  },
  {
    key: 'low_stock_products',
    label: 'Low-stock products',
    definition: 'Products currently at or below their configured reorder point. This is a point-in-time state, not a period metric.',
    formula: 'count(products where stock_quantity <= reorder_point)',
    unit: 'count',
    grain: 'product',
    numerator: 'products at or below reorder point',
    denominator: 'NONE',
    inclusions: 'active catalogue products',
    exclusions: 'none',
    source: 'inventory',
    timeField: 'observed now, not bucketed by period',
    polarity: 'INCREASE_IS_BAD',
    minimumSample: 0,
    freshnessExpectationMinutes: 15,
    owner: 'inventory',
    drilldownRoute: '/admin/inventory',
  },
] as const;

const CATALOGUE_BY_KEY = new Map(ANALYTICS_METRIC_CATALOGUE.map((definition) => [definition.key, definition]));

export function getMetricDefinition(key: string): MetricDefinition | null {
  return CATALOGUE_BY_KEY.get(key) ?? null;
}

export function requireMetricDefinition(key: string): MetricDefinition {
  const definition = CATALOGUE_BY_KEY.get(key);
  if (!definition) throw new Error(`UNKNOWN_METRIC:${key}`);
  return definition;
}
