import { sql } from 'drizzle-orm';
import { db } from '../client';

/**
 * Catalogue intelligence data access (migration 0119): battery compatibility,
 * finder telemetry, storage tests, product lifecycle decisions.
 *
 * Raw SQL via db.execute with the rowsOf guard, matching the sibling SEO
 * repositories. Public read paths NEVER select supplier or cost columns.
 */

const rowsOf = (result: unknown): any[] => (Array.isArray(result) ? result : (result as any)?.rows ?? []);

export interface BatteryCompatRow {
  phoneBrand: string;
  phoneModel: string;
  modelNumber?: string | null;
  variant?: string | null;
  batteryProductId?: string | null;
  batteryReference: string;
  status: string;
  evidenceSource?: string | null;
  evidenceNote?: string | null;
}

export class DrizzleSeoCatalogueRepository {
  // ── Battery compatibility ─────────────────────────────────────────────────

  async upsertBatteryCompat(row: BatteryCompatRow, actorId: string | null): Promise<any> {
    const verified = row.status === 'VERIFIED';
    const rows = rowsOf(await db.execute(sql`
      insert into seo_battery_compat
        (phone_brand, phone_model, model_number, variant, battery_product_id, battery_reference,
         status, evidence_source, evidence_note, verified_by, verified_at)
      values
        (${row.phoneBrand}, ${row.phoneModel}, ${row.modelNumber ?? null}, ${row.variant ?? null},
         ${row.batteryProductId ?? null}, ${row.batteryReference}, ${row.status},
         ${row.evidenceSource ?? null}, ${row.evidenceNote ?? null},
         ${verified ? actorId : null}, ${verified ? sql`now()` : sql`null`})
      on conflict (phone_brand, phone_model, coalesce(variant, ''), battery_reference) do update set
        model_number = excluded.model_number,
        battery_product_id = excluded.battery_product_id,
        status = excluded.status,
        evidence_source = excluded.evidence_source,
        evidence_note = excluded.evidence_note,
        verified_by = excluded.verified_by,
        verified_at = excluded.verified_at,
        updated_at = now()
      returning *
    `));
    return rows[0];
  }

  async listBatteryCompat(filter: { status?: string; limit?: number } = {}): Promise<any[]> {
    const limit = Math.min(Math.max(Number(filter.limit) || 200, 1), 500);
    return rowsOf(await db.execute(sql`
      select c.*, p.name as product_name, p.slug as product_slug
      from seo_battery_compat c
      left join products p on p.id = c.battery_product_id
      where (${filter.status ?? null}::text is null or c.status = ${filter.status ?? null})
      order by c.phone_brand, c.phone_model, c.battery_reference
      limit ${limit}
    `));
  }

  async deleteBatteryCompat(id: string): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`delete from seo_battery_compat where id = ${id} returning id`));
    return rows.length > 0;
  }

  async countVerifiedBatteryCompat(): Promise<number> {
    const rows = rowsOf(await db.execute(sql`select count(*)::int as n from seo_battery_compat where status = 'VERIFIED'`));
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Public finder rows: VERIFIED/PROVISIONAL only, joined to active products.
   * Pre-filters on token overlap so ranking runs over a small set. No price
   * beyond the public product price; no cost or supplier column is selected.
   */
  async searchBatteryCompat(tokens: string[]): Promise<any[]> {
    if (tokens.length === 0) return [];
    const pattern = `%${tokens[0]}%`;
    return rowsOf(await db.execute(sql`
      select c.id, c.phone_brand, c.phone_model, c.model_number, c.variant,
             c.battery_reference, c.status,
             p.id as product_id, p.name as product_name, p.slug as product_slug,
             p.price_ugx as product_price, p.image_url as product_image_url
      from seo_battery_compat c
      left join products p on p.id = c.battery_product_id
      where c.status in ('VERIFIED', 'PROVISIONAL')
        and (
          lower(c.phone_brand) like ${pattern}
          or lower(c.phone_model) like ${pattern}
          or lower(coalesce(c.model_number, '')) like ${pattern}
          or lower(c.battery_reference) like ${pattern}
          or lower(coalesce(c.variant, '')) like ${pattern}
        )
      limit 200
    `));
  }

  async recordFinderEvent(e: { query: string; phoneBrand?: string | null; phoneModel?: string | null; matched: boolean; matchCount: number }): Promise<void> {
    await db.execute(sql`
      insert into seo_battery_finder_events (query, phone_brand, phone_model, matched, match_count)
      values (${e.query.slice(0, 200)}, ${e.phoneBrand ?? null}, ${e.phoneModel ?? null}, ${e.matched}, ${e.matchCount})
    `);
  }

  /** No-match searches are catalogue gaps: what customers asked for and we could not answer. */
  async listUnmatchedFinderQueries(days = 30, limit = 50): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select query, count(*)::int as searches, max(occurred_at) as last_searched
      from seo_battery_finder_events
      where matched = false and occurred_at > now() - (${days} * interval '1 day')
      group by query
      order by searches desc, last_searched desc
      limit ${limit}
    `));
  }

  // ── Storage tests ─────────────────────────────────────────────────────────

  async addStorageTest(input: any, actorId: string): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_storage_tests
        (product_id, claimed_capacity_gb, tested_capacity_gb, read_mb_s, write_mb_s,
         method, tool, tester, tested_at, result, evidence_note, created_by)
      values
        (${input.productId}, ${input.claimedCapacityGb}, ${input.testedCapacityGb ?? null},
         ${input.readMbS ?? null}, ${input.writeMbS ?? null}, ${input.method}, ${input.tool ?? null},
         ${input.tester}, ${input.testedAt}, ${input.result}, ${input.evidenceNote ?? null}, ${actorId})
      returning *
    `));
    return rows[0];
  }

  async listStorageTests(productId?: string): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select t.*, p.name as product_name, p.slug as product_slug
      from seo_storage_tests t
      join products p on p.id = t.product_id
      where (${productId ?? null}::uuid is null or t.product_id = ${productId ?? null}::uuid)
      order by t.tested_at desc, t.created_at desc
      limit 500
    `));
  }

  async listStorageTestsForProduct(productId: string): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select result, tested_at from seo_storage_tests where product_id = ${productId}::uuid order by tested_at desc
    `));
  }

  /**
   * Storage products with their test coverage. Products with zero tests come
   * back with tests = 0 so the caller reports NOT_TESTED — they are never
   * omitted, because an absent row is exactly the thing operators must see.
   */
  async storageCoverage(): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select p.id as product_id, p.name as product_name, p.slug as product_slug,
             count(t.id)::int as tests,
             count(*) filter (where t.result = 'PASS')::int as passes,
             count(*) filter (where t.result = 'FAIL')::int as failures,
             count(*) filter (where t.result = 'INCONCLUSIVE')::int as inconclusive,
             max(t.tested_at) as last_tested_at
      from products p
      left join seo_storage_tests t on t.product_id = p.id
      where p.name ilike any (array['%flash drive%', '%memory card%', '%micro sd%', '%microsd%', '%sd card%', '%usb drive%', '%pen drive%', '%ssd%'])
      group by p.id, p.name, p.slug
      order by tests asc, p.name asc
      limit 300
    `));
  }

  // ── Product lifecycle ─────────────────────────────────────────────────────

  async upsertLifecycle(input: any, actorId: string): Promise<any> {
    const decided = input.disposition !== 'UNDECIDED';
    const rows = rowsOf(await db.execute(sql`
      insert into seo_product_lifecycle
        (product_id, state, successor_product_id, disposition, decided_by, decided_at, rationale, evidence)
      values
        (${input.productId}::uuid, ${input.state}, ${input.successorProductId ?? null},
         ${input.disposition}, ${decided ? actorId : null}, ${decided ? sql`now()` : sql`null`},
         ${input.rationale ?? null}, ${(input.evidence ?? {}) as never}::jsonb)
      on conflict (product_id) do update set
        state = excluded.state,
        successor_product_id = excluded.successor_product_id,
        disposition = excluded.disposition,
        decided_by = excluded.decided_by,
        decided_at = excluded.decided_at,
        rationale = excluded.rationale,
        evidence = excluded.evidence,
        updated_at = now()
      returning *
    `));
    return rows[0];
  }

  async listLifecycle(filter: { disposition?: string; state?: string } = {}): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select l.*, p.name as product_name, p.slug as product_slug,
             s.name as successor_name, s.slug as successor_slug
      from seo_product_lifecycle l
      join products p on p.id = l.product_id
      left join products s on s.id = l.successor_product_id
      where (${filter.disposition ?? null}::text is null or l.disposition = ${filter.disposition ?? null})
        and (${filter.state ?? null}::text is null or l.state = ${filter.state ?? null})
      order by l.updated_at desc
      limit 500
    `));
  }

  async getLifecycleForProduct(productId: string): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`
      select l.*, s.slug as successor_slug
      from seo_product_lifecycle l
      left join products s on s.id = l.successor_product_id
      where l.product_id = ${productId}::uuid
    `));
    return rows[0] ?? null;
  }

  /**
   * Products whose real stock/publication state suggests a lifecycle decision
   * is owed but none has been recorded. This is a WORK QUEUE, not an action:
   * nothing is decided here.
   */
  async lifecycleReviewQueue(limit = 100): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select p.id as product_id, p.name as product_name, p.slug as product_slug,
             p.stock_quantity, p.active,
             l.disposition, l.state
      from products p
      left join seo_product_lifecycle l on l.product_id = p.id
      where (l.id is null or l.disposition = 'UNDECIDED')
        and (coalesce(p.stock_quantity, 0) <= 0 or p.active = false)
      order by p.name
      limit ${Math.min(Math.max(Number(limit) || 100, 1), 300)}
    `));
  }
}
