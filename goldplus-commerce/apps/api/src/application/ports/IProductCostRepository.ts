/**
 * The product-cost port (0104, 2026-08-07).
 *
 * ONE owner of supplier cost. `product_prices.cost_price` is the CURRENT
 * effective value and is written only from here — it is a materialisation of
 * the entry history, never an independent truth.
 *
 * Costs are supplier data: CLAUDE.md forbids them from ever reaching a public
 * API, so nothing in this port is reachable without PRODUCT_COSTS_READ or
 * PRODUCT_COSTS_MANAGE.
 */

export interface ProductCostEntryInput {
  productId: string;
  costPriceUgx: number;
  /** ISO date (YYYY-MM-DD). The cost applies to orders placed from this day. */
  effectiveFrom: string;
  currency?: string;
  note?: string | null;
  /** The entry this one replaces, when the operator is correcting a mistake. */
  correctsEntryId?: string | null;
}

export interface RecordedProductCostEntry {
  id: string;
  productId: string;
  costPriceUgx: number;
  currency: string;
  effectiveFrom: string;
  source: string;
  note: string | null;
  enteredBy: string | null;
  correctsEntryId: string | null;
  supersededAt: Date | null;
  createdAt: Date;
}

/** One row's verdict in a batch. `rowNumber` is 1-based and is the operator's row. */
export interface ProductCostRowError {
  rowNumber: number;
  identifier: string;
  message: string;
}

export interface ProductCostImportPlanRow {
  rowNumber: number;
  productId: string;
  sku: string;
  productName: string;
  costPriceUgx: number;
  effectiveFrom: string;
  previousCostUgx: number | null;
  /** True when this row supersedes a live entry for the same product+date. */
  isCorrection: boolean;
}

export interface ProductCostImportResult {
  /** True only when EVERY row validated. A batch with any error commits nothing. */
  accepted: boolean;
  dryRun: boolean;
  totalRows: number;
  plan: ProductCostImportPlanRow[];
  errors: ProductCostRowError[];
  /** Rows actually written. Always 0 for a dry run or a rejected batch. */
  applied: number;
}

export interface ProductCostCoverageRow {
  productId: string;
  sku: string;
  productName: string;
  active: boolean;
  retailPriceUgx: number | null;
  currentCostUgx: number | null;
  effectiveFrom: string | null;
  lastEnteredAt: Date | null;
}

export interface ProductCostCoverage {
  totalActiveProducts: number;
  withCost: number;
  withoutCost: number;
  /** Percentage of active products carrying a cost, or null when there are none. */
  coveragePercent: number | null;
  rows: ProductCostCoverageRow[];
}

export interface IProductCostRepository {
  /**
   * Validate every row, then write ALL of them or NONE. `dryRun` runs the same
   * validation and returns the same plan without writing — an operator can see
   * exactly what a file would do before it does it.
   *
   * Identifiers may be a product id or a SKU; both resolve to one product or
   * the row fails.
   */
  importCosts(input: {
    rows: Array<{ identifier: string; costPriceUgx: unknown; effectiveFrom: unknown; currency?: unknown; note?: unknown }>;
    source: string;
    enteredBy: string;
    dryRun: boolean;
  }): Promise<ProductCostImportResult>;

  /** History for one product, newest first, including superseded rows. */
  listEntriesForProduct(productId: string): Promise<RecordedProductCostEntry[]>;

  /** Which active products have a cost and which do not. */
  getCoverage(limit: number): Promise<ProductCostCoverage>;
}
