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
  /** The operator's note for this entry; validated, and now actually stored. */
  note: string | null;
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

/** Today in Kampala decides which effective-dated cost is current. */
export interface IProductCostRepository {
  /** Every product whose id or SKU (case-insensitive) is among `identifiers`, with its current cost. */
  resolveProducts(identifiers: string[]): Promise<Array<{ id: string; sku: string; name: string; costPriceUgx: number | null }>>;

  /** `${productId}:${YYYY-MM-DD}` for every LIVE (not superseded) entry of these products. */
  liveEntryKeys(productIds: string[]): Promise<string[]>;

  /**
   * Writes a validated plan in ONE transaction: each row supersedes the live
   * entry for its product+date (a correction points back at it), then the
   * touched products' current cost is refreshed. Returns rows written.
   */
  applyCostPlan(input: { plan: ProductCostImportPlanRow[]; source: string; enteredBy: string }): Promise<number>;

  /**
   * Sets product_prices.cost_price to the newest live entry whose day has
   * arrived (Kampala), for every product that has entries, where it differs.
   * Returns the number of products changed.
   */
  refreshCurrentCosts(): Promise<number>;

  /** History for one product, newest first, including superseded rows. */
  listEntriesForProduct(productId: string): Promise<RecordedProductCostEntry[]>;

  /** Which active products have a cost and which do not. */
  getCoverage(limit: number): Promise<ProductCostCoverage>;
}
