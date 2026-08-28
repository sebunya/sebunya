import { sql } from 'drizzle-orm';
import { db } from '../client';
import type {
  IProductCostRepository,
  ProductCostCoverage,
  ProductCostImportPlanRow,
  ProductCostImportResult,
  ProductCostRowError,
  RecordedProductCostEntry,
} from '../../../application/ports/IProductCostRepository';

/** UGX 10bn on one line is a typo, not a cost. Mirrors the 0104 CHECK. */
const MAX_COST_UGX = 10_000_000_000;

const rowsOf = (result: any): any[] => (Array.isArray(result) ? result : result?.rows ?? []);

const isRealDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * A `date` column arrives from postgres.js as a JS Date, not a string, so
 * `String(value).slice(0, 10)` yields "Sat Sep 06" rather than "2026-09-06".
 * Every effective date crosses this one function.
 */
const toIsoDate = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

const toEntry = (row: any): RecordedProductCostEntry => ({
  id: String(row.id),
  productId: String(row.product_id),
  costPriceUgx: Number(row.cost_price_ugx),
  currency: String(row.currency),
  effectiveFrom: toIsoDate(row.effective_from),
  source: String(row.source),
  note: row.note ?? null,
  enteredBy: row.entered_by ? String(row.entered_by) : null,
  correctsEntryId: row.corrects_entry_id ? String(row.corrects_entry_id) : null,
  supersededAt: row.superseded_at ? new Date(row.superseded_at) : null,
  createdAt: new Date(row.created_at),
});

/**
 * The ONE product-cost owner.
 *
 * `importCosts` is deliberately two passes. The first resolves and validates
 * EVERY row and builds the plan; only if that pass is completely clean does the
 * second write anything, inside one transaction. A half-applied cost file is
 * worse than a rejected one: it leaves margin computed from a mixture of new
 * and stale numbers with nothing recording which is which.
 *
 * The write also refreshes `product_prices.cost_price` to the cost in force
 * TODAY, so the COGS snapshot in DrizzleOrderRepository keeps reading one
 * column and knows nothing about effective dating. A future-dated cost is
 * stored and simply does not become current until its day arrives.
 */
export class DrizzleProductCostRepository implements IProductCostRepository {
  async importCosts(input: {
    rows: Array<{ identifier: string; costPriceUgx: unknown; effectiveFrom: unknown; currency?: unknown; note?: unknown }>;
    source: string;
    enteredBy: string;
    dryRun: boolean;
  }): Promise<ProductCostImportResult> {
    const errors: ProductCostRowError[] = [];
    const plan: ProductCostImportPlanRow[] = [];

    if (input.rows.length === 0) {
      return { accepted: false, dryRun: input.dryRun, totalRows: 0, plan: [], errors: [{ rowNumber: 0, identifier: '', message: 'The file contains no rows.' }], applied: 0 };
    }

    // Resolve every identifier in one query rather than per row.
    const identifiers = input.rows.map((r) => String(r.identifier ?? '').trim()).filter(Boolean);
    const resolved = rowsOf(
      await db.execute(sql`
        select p.id, p.sku, p.name, p.active, pp.cost_price
        from products p
        left join product_prices pp on pp.product_id = p.id
        where p.id::text = any(${sql`ARRAY[${sql.join(identifiers.map((v) => sql`${v}`), sql`, `)}]::text[]`})
           or lower(p.sku) = any(${sql`ARRAY[${sql.join(identifiers.map((v) => sql`${v.toLowerCase()}`), sql`, `)}]::text[]`})
      `),
    );
    const byId = new Map<string, any>();
    const bySku = new Map<string, any>();
    for (const row of resolved) {
      byId.set(String(row.id), row);
      bySku.set(String(row.sku).toLowerCase(), row);
    }

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
        productId: String(product.id),
        sku: String(product.sku),
        productName: String(product.name),
        costPriceUgx: cost,
        effectiveFrom,
        previousCostUgx: product.cost_price === null || product.cost_price === undefined ? null : Number(product.cost_price),
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
    const liveKeys = new Set(
      rowsOf(
        await db.execute(sql`
          select product_id, effective_from
          from product_cost_entries
          where superseded_at is null
        `),
      ).map((r) => `${String(r.product_id)}:${toIsoDate(r.effective_from)}`),
    );
    for (const row of plan) {
      row.isCorrection = liveKeys.has(`${row.productId}:${row.effectiveFrom}`);
    }

    if (input.dryRun) {
      return { accepted: true, dryRun: true, totalRows: input.rows.length, plan, errors: [], applied: 0 };
    }

    let applied = 0;
    await db.transaction(async (tx) => {
      for (const row of plan) {
        // A correction supersedes the live entry for the same product+date and
        // points back at it, so the trail keeps both numbers.
        const superseded = rowsOf(
          await tx.execute(sql`
            update product_cost_entries
            set superseded_at = now()
            where product_id = ${row.productId}::uuid
              and effective_from = ${row.effectiveFrom}::date
              and superseded_at is null
            returning id
          `),
        );

        await tx.execute(sql`
          insert into product_cost_entries
            (product_id, cost_price_ugx, currency, effective_from, source, note, entered_by, corrects_entry_id)
          values
            (${row.productId}::uuid, ${row.costPriceUgx}, 'UGX', ${row.effectiveFrom}::date,
             ${input.source}, ${row.note ?? null}, ${input.enteredBy}::uuid,
             ${superseded[0]?.id ? String(superseded[0].id) : null}::uuid)
        `);
        applied += 1;
      }

      // Refresh the materialised current cost for every product this file
      // touched: the newest live entry whose effective_from has arrived.
      const touched = [...new Set(plan.map((r) => r.productId))];
      for (const productId of touched) {
        await tx.execute(sql`
          update product_prices
          set cost_price = (
            select e.cost_price_ugx
            from product_cost_entries e
            where e.product_id = ${productId}::uuid
              and e.superseded_at is null
              and e.effective_from <= current_date
            order by e.effective_from desc, e.created_at desc
            limit 1
          )
          where product_id = ${productId}::uuid
        `);
      }
    });

    return { accepted: true, dryRun: false, totalRows: input.rows.length, plan, errors: [], applied };
  }

  async listEntriesForProduct(productId: string): Promise<RecordedProductCostEntry[]> {
    const rows = rowsOf(
      await db.execute(sql`
        select * from product_cost_entries
        where product_id = ${productId}::uuid
        order by effective_from desc, created_at desc
      `),
    );
    return rows.map(toEntry);
  }

  async getCoverage(limit: number): Promise<ProductCostCoverage> {
    const summary = rowsOf(
      await db.execute(sql`
        select
          count(*)::int as total,
          count(*) filter (where pp.cost_price is not null)::int as with_cost
        from products p
        left join product_prices pp on pp.product_id = p.id
        where p.active
      `),
    )[0] ?? {};

    const total = Number(summary.total ?? 0);
    const withCost = Number(summary.with_cost ?? 0);

    const rows = rowsOf(
      await db.execute(sql`
        select p.id, p.sku, p.name, p.active,
               pp.retail_price, pp.cost_price,
               (select e.effective_from from product_cost_entries e
                 where e.product_id = p.id and e.superseded_at is null and e.effective_from <= current_date
                 order by e.effective_from desc, e.created_at desc limit 1) as effective_from,
               (select max(e.created_at) from product_cost_entries e where e.product_id = p.id) as last_entered_at
        from products p
        left join product_prices pp on pp.product_id = p.id
        where p.active
        -- Products WITHOUT a cost first: this report exists to be worked
        -- through, and the gap is the work.
        order by (pp.cost_price is not null), p.name
        limit ${limit}
      `),
    );

    return {
      totalActiveProducts: total,
      withCost,
      withoutCost: total - withCost,
      coveragePercent: total === 0 ? null : Math.round((withCost / total) * 1000) / 10,
      rows: rows.map((r) => ({
        productId: String(r.id),
        sku: String(r.sku),
        productName: String(r.name),
        active: Boolean(r.active),
        retailPriceUgx: r.retail_price === null || r.retail_price === undefined ? null : Number(r.retail_price),
        currentCostUgx: r.cost_price === null || r.cost_price === undefined ? null : Number(r.cost_price),
        effectiveFrom: r.effective_from ? toIsoDate(r.effective_from) : null,
        lastEnteredAt: r.last_entered_at ? new Date(r.last_entered_at) : null,
      })),
    };
  }
}
