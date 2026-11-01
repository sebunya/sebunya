import type {
  IProductCostRepository,
  ProductCostImportPlanRow,
  ProductCostImportResult,
  ProductCostRowError,
} from '../../ports/IProductCostRepository';

/** UGX 10bn on one line is a typo, not a cost. Mirrors the 0104 CHECK. */
const MAX_COST_UGX = 10_000_000_000;

const isRealDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export type ProductCostImportRow = { identifier: string; costPriceUgx: unknown; effectiveFrom: unknown; currency?: unknown; note?: unknown };

/**
 * Supplier-cost import: the rules live here, the SQL in the repository.
 *
 * Deliberately two passes. The first resolves and validates EVERY row and
 * builds the plan; only if that pass is completely clean does the second write
 * anything, inside one transaction. A half-applied cost file is worse than a
 * rejected one: margin would be computed from a mixture of new and stale
 * numbers with nothing recording which is which. `dryRun` returns the same
 * plan without writing.
 */
export class ImportProductCostsUseCase {
  constructor(private readonly costs: IProductCostRepository) {}

  async execute(input: { rows: ProductCostImportRow[]; source: string; enteredBy: string; dryRun: boolean }): Promise<ProductCostImportResult> {
    const errors: ProductCostRowError[] = [];
    const plan: ProductCostImportPlanRow[] = [];

    if (input.rows.length === 0) {
      return { accepted: false, dryRun: input.dryRun, totalRows: 0, plan: [], errors: [{ rowNumber: 0, identifier: '', message: 'The file contains no rows.' }], applied: 0 };
    }

    const identifiers = input.rows.map((r) => String(r.identifier ?? '').trim()).filter(Boolean);
    const resolved = identifiers.length ? await this.costs.resolveProducts(identifiers) : [];
    const byId = new Map(resolved.map((p) => [p.id, p]));
    const bySku = new Map(resolved.map((p) => [p.sku.toLowerCase(), p]));

    // A file that names the same product+date twice contradicts itself; the
    // operator must decide which is right, not the importer.
    const seen = new Map<string, number>();

    input.rows.forEach((raw, index) => {
      const rowNumber = index + 1;
      const identifier = String(raw.identifier ?? '').trim();
      const fail = (message: string) => errors.push({ rowNumber, identifier, message });

      if (!identifier) return fail('A product id or SKU is required.');
      const product = byId.get(identifier) ?? bySku.get(identifier.toLowerCase());
      if (!product) return fail(`No product matches "${identifier}".`);

      const cost = Number(raw.costPriceUgx);
      if (!Number.isInteger(cost) || cost < 0 || cost > MAX_COST_UGX) {
        return fail('Cost must be a whole number of shillings between 0 and 10,000,000,000.');
      }

      const effectiveFrom = String(raw.effectiveFrom ?? '').trim();
      if (!isRealDate(effectiveFrom)) return fail('effectiveFrom must be a real YYYY-MM-DD date.');

      const currency = String(raw.currency ?? 'UGX').toUpperCase();
      if (currency !== 'UGX') {
        return fail(`Only UGX costs are accepted today; this row is ${currency}. A second currency needs a conversion source before margin can mean anything.`);
      }

      const note = raw.note === undefined || raw.note === null ? null : String(raw.note);
      if (note !== null && note.length > 500) return fail('note exceeds 500 characters.');

      const key = `${product.id}:${effectiveFrom}`;
      const firstSeen = seen.get(key);
      if (firstSeen !== undefined) {
        return fail(`Row ${firstSeen} already sets a cost for this product on ${effectiveFrom}. One file may not state two costs for the same product and date.`);
      }
      seen.set(key, rowNumber);

      plan.push({
        rowNumber,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        costPriceUgx: cost,
        effectiveFrom,
        previousCostUgx: product.costPriceUgx,
        isCorrection: false,
        note,
      });
    });

    // Nothing is written unless the WHOLE file is clean.
    if (errors.length > 0) {
      return { accepted: false, dryRun: input.dryRun, totalRows: input.rows.length, plan, errors, applied: 0 };
    }

    // Mark which planned rows replace a live entry, so the operator sees a
    // correction as a correction before committing to it.
    const liveKeys = new Set(await this.costs.liveEntryKeys([...new Set(plan.map((r) => r.productId))]));
    for (const row of plan) row.isCorrection = liveKeys.has(`${row.productId}:${row.effectiveFrom}`);

    if (input.dryRun) {
      return { accepted: true, dryRun: true, totalRows: input.rows.length, plan, errors: [], applied: 0 };
    }

    const applied = await this.costs.applyCostPlan({ plan, source: input.source, enteredBy: input.enteredBy });
    return { accepted: true, dryRun: false, totalRows: input.rows.length, plan, errors: [], applied };
  }
}

/**
 * Makes a future-dated cost current on its day.
 *
 * product_prices.cost_price (what the COGS snapshot freezes) was refreshed only
 * by an import, and only for the products in that file, so a cost dated for
 * next month never became current. Idempotent: rows already right are not
 * touched. Run at start-up and daily just after midnight Kampala time.
 */
export class RefreshCurrentProductCostsUseCase {
  constructor(private readonly costs: Pick<IProductCostRepository, 'refreshCurrentCosts'>) {}

  execute(): Promise<number> {
    return this.costs.refreshCurrentCosts();
  }
}
