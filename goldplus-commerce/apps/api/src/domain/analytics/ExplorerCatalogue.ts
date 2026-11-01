/**
 * Self-service explorer catalogue (§7). Pure domain.
 *
 * The catalogue is the ONLY surface the explorer can query. A metric, a
 * dimension and a filter column are each a fixed key mapping to a STATIC SQL
 * fragment authored here — never anything a caller supplies. That is what makes
 * the compiler injection-proof: a request can only name catalogue keys, so no
 * user string ever becomes SQL; filter VALUES are always bound parameters.
 *
 * Data-purity (§8): the money metric is GMV (sum of order totals), explicitly
 * NOT called "revenue" — revenue requires accounting this layer does not do.
 */

export interface MetricDef {
  key: string;
  label: string;
  /** Static SQL aggregate over the base table. No user input. */
  sql: string;
  definition: string;
}

export interface DimensionDef {
  key: string;
  label: string;
  /** Static SQL group expression. */
  sql: string;
}

export interface FilterColumnDef {
  key: string;
  /** Static column reference. */
  column: string;
  kind: 'text' | 'timestamp';
  /** For text columns, the only values a filter may use (allowlist). */
  allowedValues?: string[];
}

/** The base table the explorer reports over. */
export const EXPLORER_BASE_TABLE = 'orders';

export const EXPLORER_METRICS: Record<string, MetricDef> = {
  order_count: { key: 'order_count', label: 'Orders', sql: 'count(*)', definition: 'Count of orders in scope.' },
  paid_order_count: {
    key: 'paid_order_count',
    label: 'Paid orders',
    sql: "count(*) filter (where payment_status = 'paid')",
    definition: 'Orders whose payment_status is paid.',
  },
  gmv_ugx: {
    key: 'gmv_ugx',
    label: 'GMV (UGX)',
    sql: 'coalesce(sum(total_amount), 0)',
    definition: 'Gross merchandise value = sum of order totals. NOT revenue (no accounting).',
  },
  paid_gmv_ugx: {
    key: 'paid_gmv_ugx',
    label: 'Paid GMV (UGX)',
    sql: "coalesce(sum(total_amount) filter (where payment_status = 'paid'), 0)",
    definition: 'GMV restricted to paid orders.',
  },
};

export const EXPLORER_DIMENSIONS: Record<string, DimensionDef> = {
  status: { key: 'status', label: 'Order status', sql: 'status' },
  payment_status: { key: 'payment_status', label: 'Payment status', sql: 'payment_status' },
  day: { key: 'day', label: 'Day', sql: "date_trunc('day', created_at)" },
};

export const EXPLORER_FILTERS: Record<string, FilterColumnDef> = {
  status: {
    key: 'status',
    column: 'status',
    kind: 'text',
    allowedValues: ['received', 'pending_payment', 'pending_owner_review', 'processing', 'completed', 'cancelled', 'failed'],
  },
  payment_status: {
    key: 'payment_status',
    column: 'payment_status',
    kind: 'text',
    allowedValues: ['unpaid', 'pending', 'paid', 'failed'],
  },
  created_at: { key: 'created_at', column: 'created_at', kind: 'timestamp' },
};

export const EXPLORER_MAX_ROWS = 1000;
