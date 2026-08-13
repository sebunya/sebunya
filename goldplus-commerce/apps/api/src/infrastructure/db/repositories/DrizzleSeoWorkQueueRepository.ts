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
        detail = coalesce(${input.detail ?? null}, detail),
        state = coalesce(${input.state ?? null}, state),
        priority = coalesce(${input.priority ?? null}, priority),
        assignee_id = coalesce(${input.assigneeId ?? null}, assignee_id),
        change_ledger_id = coalesce(${input.changeLedgerId ?? null}, change_ledger_id),
        target_url = coalesce(${input.targetUrl ?? null}, target_url),
        -- An absent key means UNCHANGED, not CLEARED: advancing an item
        -- without re-picking its outcome used to null a recorded IMPROVED
        -- while outcome_measured_at survived, showing 'not measured yet'
        -- next to a real measurement date.
        outcome = coalesce(${input.outcome ?? null}, outcome),
        outcome_note = coalesce(${input.outcomeNote ?? null}, outcome_note),
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
    // Aggregated in SQL, one row per (category, competitor). Shipping raw
    // observations under a `limit` was unsafe: a competitor whose sightings
    // fell outside the cap became NOT_OBSERVED — the grid would positively
    // assert their absence because of a row limit.
    return rowsOf(await db.execute(sql`
      select q.category as category, o.competitor_id,
             min(o.rank)::int as rank,
             count(*)::int as sightings,
             max(o.observed_at) as observed_at
      from seo_serp_observations o
      join seo_queries q on q.id = o.query_id
      where o.competitor_id is not null
        and q.category is not null and q.category <> ''
        and o.observed_at > now() - (${days} * interval '1 day')
      group by q.category, o.competitor_id
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

  // ── Organic Intelligence reads (0122) ─────────────────────────────────────

  /** Portfolio summary. Bounded, ordered by adjusted score, closed excluded. */
  async listOpportunities(filter: { bucket?: string; limit?: number } = {}): Promise<any[]> {
    const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
    return rowsOf(await db.execute(sql`
      select opportunity_key, opportunity_class, entity_type, entity_id, entity_label,
             root_cause_key, score, adjusted_score, unscored_weight_share,
             commercial_readiness, seo_ready, content_ready, confidence,
             evidence_completeness, evidence_available, evidence_missing,
             effort, risk, priority_bucket, recommended_action_class, status,
             work_item_id, policy_version, first_seen_at, last_material_change_at
      from seo_intel_opportunities
      where status not in ('CLOSED','DECAYED')
        and (${filter.bucket ?? null}::text is null or priority_bucket = ${filter.bucket ?? null})
      order by
        case priority_bucket when 'NOW' then 0 when 'NEXT' then 1 when 'BLOCKED' then 2 else 3 end,
        adjusted_score desc nulls last
      limit ${limit}
    `));
  }

  /**
   * The full decision record for one opportunity: components with raw
   * evidence, what was unknown, the policy in force, root-cause siblings and
   * the material history.
   */
  async explainOpportunity(key: string): Promise<any | null> {
    const opp = rowsOf(await db.execute(sql`
      select * from seo_intel_opportunities where opportunity_key = ${key}
    `))[0];
    if (!opp) return null;

    const components = rowsOf(await db.execute(sql`
      select component, raw_evidence, evidence_state, normalized, weight, contribution, reason_code, policy_version
      from seo_intel_score_components
      where opportunity_key = ${key} and evaluation_hash = ${opp.evaluation_hash}
      order by contribution desc
    `));
    const history = rowsOf(await db.execute(sql`
      select event_type, from_state, to_state, reason, policy_version, occurred_at
      from seo_intel_history where opportunity_key = ${key}
      order by occurred_at desc limit 50
    `));
    const siblings = opp.root_cause_key
      ? rowsOf(await db.execute(sql`
          select opportunity_key, entity_label, adjusted_score
          from seo_intel_opportunities
          where root_cause_key = ${opp.root_cause_key} and opportunity_key <> ${key}
          order by adjusted_score desc nulls last limit 50
        `))
      : [];

    return { opportunity: opp, components, history, rootCauseSiblings: siblings };
  }

  async listIntelRuns(limit = 20): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select id, mode, status, started_at, finished_at, policy_version,
             entities_evaluated, opportunities_created, opportunities_updated,
             opportunities_unchanged, history_events, evidence_state, error
      from seo_intel_runs order by started_at desc limit ${Math.min(Math.max(limit, 1), 100)}
    `));
  }

  // ── Organic Intelligence domains materialised by 0123 ─────────────────────

  /**
   * Query clusters with their intent and ownership decision. Demand columns
   * stay NULL until a provider actually reports them, so the surface can
   * distinguish "no demand" from "nobody has told us".
   */
  async listIntelClusters(limit = 100): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select c.cluster_key, c.label, c.cluster_method, c.cluster_confidence,
             c.member_count, c.primary_intent, c.secondary_intent, c.intent_method,
             c.current_owner_url, c.preferred_owner_url, c.preferred_owner_type,
             c.ownership_decision, c.ownership_rationale,
             c.impressions, c.clicks, c.demand_state, c.updated_at,
             (select count(*) from seo_intel_query_membership m where m.cluster_key = c.cluster_key) as membership_rows
      from seo_intel_clusters c
      order by c.member_count desc, c.label
      limit ${Math.min(Math.max(limit, 1), 500)}
    `));
  }

  /** The queries placed in one cluster, with their provenance. */
  async listClusterMembership(clusterKey: string, limit = 200): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select raw_query, normalized_query, membership_method, membership_confidence,
             source, source_observed_at, is_backfill, demand_state, impressions, clicks
      from seo_intel_query_membership
      where cluster_key = ${clusterKey}
      order by raw_query
      limit ${Math.min(Math.max(limit, 1), 1000)}
    `));
  }

  async listIntelCannibalisation(limit = 100): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select finding_key, cluster_key, classification, confidence, rationale,
             affected_urls, persistence, status, resolved_reason,
             first_seen_at, last_material_change_at
      from seo_intel_cannibalisation
      where status <> 'SUPERSEDED'
      order by last_material_change_at desc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `));
  }

  async listIntelContent(limit = 200): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select content_key, url, classification, primary_intent, cluster_key,
             content_completeness, commercial_value, performance_state,
             first_seen_at, last_material_change_at
      from seo_intel_content
      order by last_material_change_at desc
      limit ${Math.min(Math.max(limit, 1), 1000)}
    `));
  }

  /**
   * What the system would propose, and why it is not authorised to do it.
   * Autonomy is level 0, so this is a review surface, never a queue of
   * pending executions.
   */
  async listIntelActionRequests(limit = 100): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select request_key, opportunity_key, action_class, entity_id, state,
             decision_reason, confidence, blast_radius, rollback_class,
             preconditions, unmet_preconditions, expected_effect,
             verification_plan, policy_version, updated_at
      from seo_intel_action_requests
      order by updated_at desc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `));
  }

  /**
   * Content GAPS are opportunities of class CREATE_CONTENT — deliberately not
   * a separate table, so one fix and one root cause cover both.
   */
  async listIntelContentGaps(limit = 100): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select opportunity_key, entity_type, entity_id, entity_label, priority_bucket,
             adjusted_score, confidence, evidence_completeness, blocked_by, status
      from seo_intel_opportunities
      where recommended_action_class = 'CREATE_CONTENT' and status <> 'CLOSED'
      order by adjusted_score desc nulls last
      limit ${Math.min(Math.max(limit, 1), 500)}
    `));
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
