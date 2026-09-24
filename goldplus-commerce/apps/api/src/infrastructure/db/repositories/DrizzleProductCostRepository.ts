import { sql } from 'drizzle-orm';
import { db } from '../client';
import type {
  IProductCostRepository,
  ProductCostCoverage,
  ProductCostImportPlanRow,
  RecordedProductCostEntry,
} from '../../../application/ports/IProductCostRepository';

const rowsOf = (result: any): any[] => (Array.isArray(result) ? result : result?.rows ?? []);

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
 * "Today" for effective dating is the Kampala calendar day. The database clock
 * is UTC, so current_date turned over three hours late: a cost dated for
 * 1 October was not current for orders placed between 00:00 and 03:00 EAT.
 */
const KAMPALA_TODAY = sql`(now() at time zone 'Africa/Kampala')::date`;

/** The newest live entry whose day has arrived, for the product in `productIdSql`. */
const currentCostFor = (productIdSql: ReturnType<typeof sql>) => sql`(
  select e.cost_price_ugx
  from product_cost_entries e
  where e.product_id = ${productIdSql}
    and e.superseded_at is null
    and e.effective_from <= ${KAMPALA_TODAY}
  order by e.effective_from desc, e.created_at desc
  limit 1
)`;

/**
 * The ONE product-cost store. The import RULES (validation, the plan, the
 * all-or-nothing decision) live in ImportProductCostsUseCase; this class only
 * reads and writes.
 *
 * `product_prices.cost_price` is the cost in force TODAY, so the COGS snapshot
 * in DrizzleOrderRepository keeps reading one column and knows nothing about
 * effective dating. A future-dated cost becomes current when refreshCurrentCosts
 * runs on or after its day (daily, and at start-up).
 */
export class DrizzleProductCostRepository implements IProductCostRepository {
  async resolveProducts(identifiers: string[]): Promise<Array<{ id: string; sku: string; name: string; costPriceUgx: number | null }>> {
    if (identifiers.length === 0) return [];
    const rows = rowsOf(
      await db.execute(sql`
        select p.id, p.sku, p.name, pp.cost_price
        from products p
        left join product_prices pp on pp.product_id = p.id
        where p.id::text = any(${sql`ARRAY[${sql.join(identifiers.map((v) => sql`${v}`), sql`, `)}]::text[]`})
           or lower(p.sku) = any(${sql`ARRAY[${sql.join(identifiers.map((v) => sql`${v.toLowerCase()}`), sql`, `)}]::text[]`})
      `),
    );
    return rows.map((r) => ({
      id: String(r.id),
      sku: String(r.sku),
      name: String(r.name),
      costPriceUgx: r.cost_price === null || r.cost_price === undefined ? null : Number(r.cost_price),
    }));
  }

  async liveEntryKeys(productIds: string[]): Promise<string[]> {
    if (productIds.length === 0) return [];
    return rowsOf(
      await db.execute(sql`
        select product_id, effective_from
        from product_cost_entries
        where superseded_at is null
          and product_id::text = any(${sql`ARRAY[${sql.join(productIds.map((v) => sql`${v}`), sql`, `)}]::text[]`})
      `),
    ).map((r) => `${String(r.product_id)}:${toIsoDate(r.effective_from)}`);
  }

  async applyCostPlan(input: { plan: ProductCostImportPlanRow[]; source: string; enteredBy: string }): Promise<number> {
    let applied = 0;
    await db.transaction(async (tx) => {
      for (const row of input.plan) {
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

      // Refresh the materialised current cost for every product this file touched.
      const touched = [...new Set(input.plan.map((r) => r.productId))];
      for (const productId of touched) {
        await tx.execute(sql`
          update product_prices
          set cost_price = ${currentCostFor(sql`${productId}::uuid`)}
          where product_id = ${productId}::uuid
        `);
      }
    });
    return applied;
  }

  async refreshCurrentCosts(): Promise<number> {
    const rows = rowsOf(
      await db.execute(sql`
        update product_prices pp
        set cost_price = ${currentCostFor(sql`pp.product_id`)}
        where exists (select 1 from product_cost_entries e where e.product_id = pp.product_id)
          and pp.cost_price is distinct from ${currentCostFor(sql`pp.product_id`)}
        returning pp.product_id
      `),
    );
    return rows.length;
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
                 where e.product_id = p.id and e.superseded_at is null and e.effective_from <= ${KAMPALA_TODAY}
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
