import { sql } from 'drizzle-orm';
import { db } from '../client';

/**
 * SEO work queue + category×competitor matrix data access (migration 0120 for
 * seo_work_items; the matrix derives from the EXISTING 0116 observation
 * tables — a derived view needs no table of its own).
 *
 * Raw SQL via db.execute with the rowsOf guard, matching the sibling SEO
 * repositories.
 */

const rowsOf = (result: unknown): any[] => (Array.isArray(result) ? result : (result as any)?.rows ?? []);

export class DrizzleSeoWorkQueueRepository {
  // ── Work items ────────────────────────────────────────────────────────────

  async createWorkItem(input: any, actorId: string): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_work_items
        (title, detail, state, priority, opportunity_id, gap_id, observation_id,
         change_ledger_id, target_url, assignee_id, created_by)
      values
        (${input.title}, ${input.detail ?? null}, ${input.state}, ${input.priority},
         ${input.opportunityId ?? null}, ${input.gapId ?? null}, ${input.observationId ?? null},
         ${input.changeLedgerId ?? null}, ${input.targetUrl ?? null}, ${input.assigneeId ?? null}, ${actorId})
      returning *
    `));
    return rows[0];
  }

  async getWorkItem(id: string): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`select * from seo_work_items where id = ${id}::uuid`));
    return rows[0] ?? null;
  }

  async updateWorkItem(id: string, input: any): Promise<any> {
    // outcome_measured_at is stamped by the DB the moment an outcome is first
    // recorded, so "when did we check?" is never guessed after the fact.
    const rows = rowsOf(await db.execute(sql`
      update seo_work_items set
        title = coalesce(${input.title ?? null}, title),
        detail = ${input.detail ?? null},
        state = coalesce(${input.state ?? null}, state),
        priority = coalesce(${input.priority ?? null}, priority),
        assignee_id = ${input.assigneeId ?? null},
        change_ledger_id = coalesce(${input.changeLedgerId ?? null}, change_ledger_id),
        target_url = coalesce(${input.targetUrl ?? null}, target_url),
        outcome = ${input.outcome ?? null},
        outcome_note = ${input.outcomeNote ?? null},
        outcome_measured_at = case
          when ${input.outcome ?? null}::text is not null and outcome is distinct from ${input.outcome ?? null}
          then now() else outcome_measured_at end,
        started_at = case when ${input.state ?? null} = 'IN_PROGRESS' and started_at is null then now() else started_at end,
        completed_at = case when ${input.state ?? null} = 'DONE' then now() else completed_at end,
        updated_at = now()
      where id = ${id}::uuid
      returning *
    `));
    return rows[0];
  }

  async listWorkItems(filter: { state?: string; priority?: string } = {}): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select * from seo_work_items
      where (${filter.state ?? null}::text is null or state = ${filter.state ?? null})
        and (${filter.priority ?? null}::text is null or priority = ${filter.priority ?? null})
      order by
        case priority when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end,
        created_at desc
      limit 500
    `));
  }

  /** Open opportunities with no work item yet — the queue's inbox. */
  async unpromotedOpportunities(limit = 50): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select o.*
      from seo_opportunities o
      left join seo_work_items w on w.opportunity_id = o.id
      where w.id is null and o.status = 'OPEN'
      order by o.created_at desc
      limit ${Math.min(Math.max(Number(limit) || 50, 1), 200)}
    `));
  }

  // ── Category × competitor matrix inputs ───────────────────────────────────

  /** The category axis: every category our tracked queries belong to. */
  async matrixCategories(): Promise<string[]> {
    const rows = rowsOf(await db.execute(sql`
      select distinct category from seo_queries
      where category is not null and category <> ''
      order by category
    `));
    return rows.map((r) => String(r.category));
  }

  async matrixCompetitors(): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select id, canonical_name, category_overlap
      from seo_competitors
      where status = 'ACTIVE'
      order by canonical_name
    `));
  }

  /**
   * Every SERP sighting of a tracked competitor, tagged with the category of
   * the query it was observed on. Rows with no competitor_id are excluded from
   * the per-competitor join but still counted in the category sample size by
   * matrixCategorySampleSize — otherwise "we looked" would collapse into "we
   * never looked".
   */
  async matrixObservations(days = 90): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select q.category as category, o.competitor_id, o.rank, o.observed_at
      from seo_serp_observations o
      join seo_queries q on q.id = o.query_id
      where o.competitor_id is not null
        and q.category is not null and q.category <> ''
        and o.observed_at > now() - (${days} * interval '1 day')
      limit 20000
    `));
  }

  /** How many observations exist per category, competitor or not. */
  async matrixCategorySampleSize(days = 90): Promise<Array<{ category: string; observations: number }>> {
    const rows = rowsOf(await db.execute(sql`
      select q.category as category, count(*)::int as observations
      from seo_serp_observations o
      join seo_queries q on q.id = o.query_id
      where q.category is not null and q.category <> ''
        and o.observed_at > now() - (${days} * interval '1 day')
      group by q.category
    `));
    return rows.map((r) => ({ category: String(r.category), observations: Number(r.observations) }));
  }

  /** Our own best observed rank per category, for the outrank gap. */
  async ourBestRankByCategory(days = 90): Promise<Array<{ category: string; bestRank: number | null }>> {
    const rows = rowsOf(await db.execute(sql`
      select q.category as category, min(o.rank)::int as best_rank
      from seo_serp_observations o
      join seo_queries q on q.id = o.query_id
      where o.competitor_id is null
        and o.domain ilike '%shopgoldplus%'
        and q.category is not null and q.category <> ''
        and o.observed_at > now() - (${days} * interval '1 day')
      group by q.category
    `));
    return rows.map((r) => ({ category: String(r.category), bestRank: r.best_rank === null ? null : Number(r.best_rank) }));
  }
}
