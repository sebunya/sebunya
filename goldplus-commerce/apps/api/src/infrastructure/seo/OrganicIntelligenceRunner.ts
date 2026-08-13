import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import {
  OrganicIntelligenceMaterialiser,
  type MaterialiserPorts, type MaterialisationMode, type EntityCandidate, type MaterialisationResult,
} from '../../application/use-cases/seo-growth/OrganicIntelligenceMaterialiser';
import type { StoredSnapshot } from '../../application/use-cases/seo-growth/OrganicIntelligenceIdentity';
import { known, unknown } from '../../application/use-cases/seo-growth/OrganicOpportunityScoring';

/**
 * Binds the materialiser to real storage. All decisions live in the use case;
 * this file only reads canonical GoldPlus truth and writes the result.
 *
 * Concurrency: an advisory lock serialises materialisation across replicas.
 * Combined with the unique semantic-key indexes, a losing racer stands down
 * rather than producing a duplicate universe.
 */

const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : (r as any)?.rows ?? []);

const INTEL_LOCK_ID = 887_401_122;
const STALE_RUN_MINUTES = 45;

export async function runOrganicIntelligence(mode: MaterialisationMode = 'INCREMENTAL'): Promise<MaterialisationResult> {
  const conn = db as unknown as { execute: (q: unknown) => Promise<unknown> };
  let lockHeld = false;

  const ports: MaterialiserPorts = {
    async startRun(i) {
      const got = rowsOf(await conn.execute(sql`select pg_try_advisory_lock(${INTEL_LOCK_ID}) as ok`));
      if (got[0]?.ok !== true) return null;
      lockHeld = true;

      // Reap an abandoned predecessor so a crash cannot block for ever.
      await conn.execute(sql`
        update seo_intel_runs set status = 'ABANDONED', finished_at = now(),
          error = 'Abandoned: no completion within the stale window.'
        where status = 'STARTED' and started_at < now() - (${STALE_RUN_MINUTES} * interval '1 minute')
      `);

      const rows = rowsOf(await conn.execute(sql`
        insert into seo_intel_runs (mode, status, policy_version, engine_version, materialisation_version)
        values (${i.mode}, 'STARTED', ${i.policyVersion}, ${i.engineVersion}, ${i.materialisationVersion})
        returning id
      `));
      return { runId: String(rows[0]?.id ?? '') };
    },

    async finishRun(f) {
      await conn.execute(sql`
        update seo_intel_runs set
          status = ${f.status}, finished_at = now(),
          entities_evaluated = ${f.counts.entitiesEvaluated},
          opportunities_created = ${f.counts.created},
          opportunities_updated = ${f.counts.updated},
          opportunities_unchanged = ${f.counts.unchanged},
          opportunities_closed = ${f.counts.closed},
          history_events = ${f.counts.historyEvents},
          work_items_created = ${f.counts.workItemsCreated},
          work_items_updated = ${f.counts.workItemsUpdated},
          evidence_state = ${f.evidenceState as never}::jsonb,
          error = ${f.error ?? null}
        where id = ${f.runId}::uuid
      `);
    },

    /**
     * Candidates from canonical GoldPlus truth. Search demand is deliberately
     * absent until Search Console is connected — it is reported UNKNOWN, never
     * zero, so the engine scores on what is genuinely known.
     */
    async loadCandidates(_mode) {
      const cats = rowsOf(await conn.execute(sql`
        select c.id::text as category_id, c.name, c.slug,
               count(p.id) filter (where p.active = true and p.approval_status = 'approved')::int as eligible,
               count(p.id) filter (where p.active = true and p.approval_status = 'approved' and coalesce(p.stock_quantity,0) > 0)::int as in_stock,
               count(p.id) filter (where p.active = true and coalesce(p.price_ugx,0) <= 0)::int as unpriced
        from categories c
        left join products p on p.category_id = c.id
        group by c.id, c.name, c.slug
        order by c.name
        limit 500
      `));

      return cats.map((r): EntityCandidate => {
        const eligible = Number(r.eligible ?? 0);
        const inStock = Number(r.in_stock ?? 0);
        const unpriced = Number(r.unpriced ?? 0);
        return {
          entityType: 'CATEGORY',
          entityId: `/${String(r.slug)}`,
          entityLabel: String(r.name),
          templateFamily: 'category',
          commercial: {
            eligibleProducts: known(eligible, 'catalogue'),
            inStockProducts: known(inStock, 'inventory'),
            pricingComplete: known(unpriced === 0, 'catalogue'),
            lifecycleBlocked: known(false, 'lifecycle'),
          },
          seoBlockers: [],
          contentThin: eligible < 3,
          hasOwnerPage: true,
          components: [
            { component: 'CATALOGUE_DEPTH', raw: eligible, normalized: Math.min(1, eligible / 20), state: 'KNOWN', reasonCode: 'eligible_products' },
            { component: 'STOCK_CONFIDENCE', raw: inStock, normalized: eligible === 0 ? 0 : inStock / eligible, state: 'KNOWN', reasonCode: 'in_stock_ratio' },
            { component: 'COMMERCIAL_INTENT', raw: 'CATEGORY', normalized: 0.8, state: 'KNOWN', reasonCode: 'category_is_commercial' },
            // Not zero. Unknown.
            { component: 'SEARCH_DEMAND', raw: null, normalized: null, state: 'UNKNOWN', reasonCode: 'search_console_not_connected' },
            { component: 'CONVERSION_SIGNAL', raw: null, normalized: null, state: 'UNKNOWN', reasonCode: 'ga4_not_connected' },
            { component: 'REVENUE_SIGNAL', raw: null, normalized: null, state: 'UNKNOWN', reasonCode: 'ga4_not_connected' },
          ],
          evidenceStates: {
            COMMERCE: 'KNOWN', TECHNICAL: 'KNOWN', CONTENT: 'KNOWN',
            SEARCH_DEMAND: 'UNKNOWN', GA4: 'UNKNOWN', MERCHANT: 'UNKNOWN',
            LINK_GRAPH: 'UNKNOWN', COMPETITOR: 'UNKNOWN', GBP: 'UNKNOWN', CWV: 'UNKNOWN',
          },
          effort: eligible === 0 ? 'HIGH' : 'MEDIUM',
          risk: 'LOW',
          confirmingSignals: 2,
          persistent: true,
          staleEvidence: false,
        };
      });
    },

    async loadSnapshots(keys) {
      if (keys.length === 0) return new Map();
      const rows = rowsOf(await conn.execute(sql`
        select opportunity_key, source_hash, semantic_hash, evaluation_hash, policy_version,
               evidence_available, score, priority_bucket
        from seo_intel_opportunities
        -- A raw JS array binds as a RECORD, so casting it to a text array fails
        -- with "cannot cast type record to text[]". Bind as jsonb text and
        -- expand it, the same array rule used elsewhere in this codebase.
        where opportunity_key in (
          select jsonb_array_elements_text(${JSON.stringify(keys)}::text::jsonb)
        )
      `));
      const map = new Map<string, StoredSnapshot>();
      for (const r of rows) {
        map.set(String(r.opportunity_key), {
          sourceHash: String(r.source_hash),
          semanticHash: String(r.semantic_hash),
          evaluationHash: String(r.evaluation_hash),
          policyVersion: String(r.policy_version),
          evidenceAvailable: Array.isArray(r.evidence_available) ? r.evidence_available.map(String) : [],
          score: r.score === null ? null : Number(r.score),
          priorityBucket: String(r.priority_bucket),
        });
      }
      return map;
    },

    async upsertOpportunity({ runId, opportunity: o, isNew }) {
      // ON CONFLICT against the PLAIN unique index on opportunity_key. Deliberately
      // not partial — the Guardian's partial-index trap does not recur here.
      // first_seen_at and created_run_id are preserved on update, so a FULL_REBUILD
      // cannot rewrite an opportunity's origin.
      await conn.execute(sql`
        insert into seo_intel_opportunities (
          opportunity_key, opportunity_class, entity_type, entity_id, entity_label, root_cause_key,
          policy_version, engine_version, materialisation_version,
          source_hash, semantic_hash, evaluation_hash,
          score, adjusted_score, unscored_weight_share,
          commercial_readiness, seo_ready, content_ready, seo_blockers,
          confidence, evidence_completeness, evidence_available, evidence_missing,
          effort, risk, priority_bucket, recommended_action_class, blocked_by, status,
          source_observed_at, source_period_start, source_period_end,
          created_run_id, last_run_id
        ) values (
          ${o.opportunityKey}, ${o.opportunityClass}, ${o.entityType}, ${o.entityId}, ${o.entityLabel}, ${o.rootCauseKey},
          ${o.policyVersion}, ${o.engineVersion}, ${o.materialisationVersion},
          ${o.sourceHash}, ${o.semanticHash}, ${o.evaluationHash},
          ${o.score}, ${o.adjustedScore}, ${o.unscoredWeightShare},
          ${o.commercialReadiness}, ${o.seoReady}, ${o.contentReady}, ${JSON.stringify(o.seoBlockers)}::text::jsonb,
          ${o.confidence}, ${o.evidenceCompleteness}, ${JSON.stringify(o.evidenceAvailable)}::text::jsonb, ${JSON.stringify(o.evidenceMissing)}::text::jsonb,
          ${o.effort}, ${o.risk}, ${o.priorityBucket}, ${o.recommendedActionClass}, ${JSON.stringify(o.blockedBy)}::text::jsonb, ${o.status},
          ${o.sourceObservedAt}, ${o.sourcePeriodStart}, ${o.sourcePeriodEnd},
          ${runId}::uuid, ${runId}::uuid
        )
        on conflict (opportunity_key) do update set
          opportunity_class = excluded.opportunity_class,
          entity_label = excluded.entity_label,
          root_cause_key = excluded.root_cause_key,
          policy_version = excluded.policy_version,
          engine_version = excluded.engine_version,
          materialisation_version = excluded.materialisation_version,
          source_hash = excluded.source_hash,
          semantic_hash = excluded.semantic_hash,
          evaluation_hash = excluded.evaluation_hash,
          score = excluded.score,
          adjusted_score = excluded.adjusted_score,
          unscored_weight_share = excluded.unscored_weight_share,
          commercial_readiness = excluded.commercial_readiness,
          seo_ready = excluded.seo_ready,
          content_ready = excluded.content_ready,
          seo_blockers = excluded.seo_blockers,
          confidence = excluded.confidence,
          evidence_completeness = excluded.evidence_completeness,
          evidence_available = excluded.evidence_available,
          evidence_missing = excluded.evidence_missing,
          effort = excluded.effort,
          risk = excluded.risk,
          priority_bucket = excluded.priority_bucket,
          recommended_action_class = excluded.recommended_action_class,
          blocked_by = excluded.blocked_by,
          status = excluded.status,
          last_seen_at = now(),
          last_material_change_at = now(),
          materialised_at = now(),
          last_run_id = excluded.last_run_id
      `);
      if (isNew) logger.debug({ key: o.opportunityKey }, '[OrganicIntelligence] opportunity created');
    },

    async writeComponents({ opportunityKey, policyVersion, evaluationHash, components }) {
      for (const c of components) {
        await conn.execute(sql`
          insert into seo_intel_score_components
            (opportunity_key, policy_version, evaluation_hash, component, raw_evidence,
             evidence_state, normalized, weight, contribution, reason_code)
          values
            (${opportunityKey}, ${policyVersion}, ${evaluationHash}, ${c.component},
             ${JSON.stringify(c.raw ?? null)}::text::jsonb, ${c.evidenceState},
             ${c.normalized}, ${c.weight}, ${c.contribution}, ${c.reasonCode})
          on conflict (opportunity_key, evaluation_hash, component) do update set
            normalized = excluded.normalized,
            contribution = excluded.contribution,
            evaluated_at = now()
        `);
      }
    },

    async writeHistory(h) {
      await conn.execute(sql`
        insert into seo_intel_history
          (opportunity_key, run_id, event_type, from_state, to_state, reason, policy_version)
        values
          (${h.opportunityKey}, ${h.runId}::uuid, ${h.eventType},
           ${JSON.stringify(h.fromState ?? null)}::text::jsonb, ${JSON.stringify(h.toState ?? null)}::text::jsonb,
           ${h.reason}, ${h.policyVersion})
      `);
    },

    async touchSeen({ opportunityKey, runId }) {
      // Freshness only. last_material_change_at is deliberately NOT moved: an
      // unchanged reconciliation must leave the semantic timeline untouched.
      await conn.execute(sql`
        update seo_intel_opportunities
        set last_seen_at = now(), last_run_id = ${runId}::uuid
        where opportunity_key = ${opportunityKey}
      `);
    },

    async upsertRootCause({ rootCauseKey, summary, memberKeys, unlockedScore }) {
      // Root causes ride the opportunity table as TEMPLATE entities, so the
      // portfolio stays one universe rather than two.
      await conn.execute(sql`
        insert into seo_intel_opportunities (
          opportunity_key, opportunity_class, entity_type, entity_id, entity_label,
          policy_version, engine_version, materialisation_version,
          source_hash, semantic_hash, evaluation_hash,
          adjusted_score, priority_bucket, status, recommended_action_class,
          evidence_available, evidence_missing
        ) values (
          ${rootCauseKey}, 'ROOT_CAUSE', 'TEMPLATE', ${rootCauseKey}, ${summary},
          '1.0.0', '1.0.0', 1,
          ${`rc:${memberKeys.length}`}, ${`rc:${memberKeys.sort().join('|').slice(0, 200)}`}, ${`rc:${unlockedScore}`},
          ${unlockedScore}, 'NOW', 'OPEN', 'CLEAR_TECHNICAL_BLOCKER',
          '[]'::jsonb, '[]'::jsonb
        )
        on conflict (opportunity_key) do update set
          entity_label = excluded.entity_label,
          adjusted_score = excluded.adjusted_score,
          semantic_hash = excluded.semantic_hash,
          last_seen_at = now()
      `);
    },

    async reconcileWorkItem({ opportunityKey, title, detail, priority, material, targetUrl }) {
      if (!material) return { workItemId: null, created: false, updated: false };
      // Deduplicated on the OPPORTUNITY key carried in target_url-independent
      // detail: one opportunity yields at most one work item, ever.
      const existing = rowsOf(await conn.execute(sql`
        select id from seo_work_items where detail like ${`%${opportunityKey}%`} limit 1
      `));
      if (existing[0]?.id) {
        await conn.execute(sql`
          update seo_work_items set title = ${title}, priority = ${priority}, updated_at = now()
          where id = ${existing[0].id}::uuid
        `);
        return { workItemId: String(existing[0].id), created: false, updated: true };
      }
      const rows = rowsOf(await conn.execute(sql`
        insert into seo_work_items (title, detail, state, priority, target_url, created_by)
        values (${title}, ${`${detail}\n\n[opportunity:${opportunityKey}]`}, 'BACKLOG', ${priority}, ${targetUrl},
                coalesce((select id from users order by created_at limit 1), gen_random_uuid()))
        returning id
      `));
      return { workItemId: String(rows[0]?.id ?? ''), created: true, updated: false };
    },

    async linkWorkItem({ opportunityKey, workItemId }) {
      await conn.execute(sql`
        update seo_intel_opportunities set work_item_id = ${workItemId}::uuid
        where opportunity_key = ${opportunityKey} and work_item_id is distinct from ${workItemId}::uuid
      `);
    },

    async upsertAnswerUnit(a) {
      await conn.execute(sql`
        insert into seo_intel_answer_units (
          answer_key, template_id, display_question, intent, answer_type,
          readiness, confidence, blocked_reason, fact_refs, missing_facts,
          unverified_facts, product_entities, category_entities, fact_hash
        ) values (
          ${a.answerKey}, ${a.templateId}, ${a.displayQuestion}, ${a.intent}, ${a.answerType},
          ${a.readiness}, ${a.confidence}, ${a.blockedReason},
          ${JSON.stringify(a.factRefs)}::text::jsonb, ${JSON.stringify(a.missingFacts)}::text::jsonb,
          ${JSON.stringify(a.unverifiedFacts)}::text::jsonb, ${JSON.stringify(a.productEntities)}::text::jsonb,
          ${JSON.stringify(a.categoryEntities)}::text::jsonb, ${a.factHash}
        )
        on conflict (answer_key) do update set
          display_question = excluded.display_question,
          readiness = excluded.readiness,
          confidence = excluded.confidence,
          blocked_reason = excluded.blocked_reason,
          fact_refs = excluded.fact_refs,
          missing_facts = excluded.missing_facts,
          unverified_facts = excluded.unverified_facts,
          fact_hash = excluded.fact_hash,
          last_evaluated_at = now(),
          last_material_change_at = now()
      `);
      return { changed: true };
    },

    async loadAnswerUnitHashes(keys) {
      if (keys.length === 0) return new Map();
      const rows = rowsOf(await conn.execute(sql`
        select answer_key, fact_hash from seo_intel_answer_units
        where answer_key in (
          select jsonb_array_elements_text(${JSON.stringify(keys)}::text::jsonb)
        )
      `));
      return new Map(rows.map((r) => [String(r.answer_key), String(r.fact_hash)]));
    },
  };

  try {
    return await new OrganicIntelligenceMaterialiser(ports).execute(mode);
  } catch (err: any) {
    logger.error({ err: String(err?.message ?? err) }, '[OrganicIntelligence] run threw');
    throw err;
  } finally {
    if (lockHeld) await conn.execute(sql`select pg_advisory_unlock(${INTEL_LOCK_ID})`).catch(() => undefined);
  }
}
