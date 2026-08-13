import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import { pgJsonb, pgInTextList } from '../db/PgParams';
import {
  resolveSourceChanges, stateHashOf, type SourceStatePorts,
} from '../../application/use-cases/seo-growth/SourceStateResolver';
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
          evidence_state = ${pgJsonb(f.evidenceState)},
          error = ${f.error ?? null}
        where id = ${f.runId}::uuid
      `);
    },

    /**
     * Candidates from canonical GoldPlus truth. Search demand is deliberately
     * absent until Search Console is connected — it is reported UNKNOWN, never
     * zero, so the engine scores on what is genuinely known.
     */
    async loadCandidates(_mode, affected) {
      // The planner's affected set is authoritative when present. Slugs are
      // how a CATEGORY entity is identified downstream, so the narrowing is
      // applied on the slug the planner named.
      // A category and its URL share the "/slug" namespace, so the planner can
      // legitimately name the same thing as both a direct CATEGORY and a
      // dependent URL. Deduplicate, or the entity is evaluated twice.
      const wanted = affected === null ? null
        : [...new Set(
            affected
              .filter((a) => a.entityType === 'CATEGORY' || a.entityType === 'URL')
              .map((a) => a.entityId.replace(/^\//, '')),
          )];
      // An EXACT plan that touches no category legitimately evaluates nothing.
      if (wanted !== null && wanted.length === 0) return [];

      const cats = rowsOf(await conn.execute(sql`
        select c.id::text as category_id, c.name, c.slug,
               count(p.id) filter (where p.active = true and p.approval_status = 'approved')::int as eligible,
               count(p.id) filter (where p.active = true and p.approval_status = 'approved' and coalesce(p.stock_quantity,0) > 0)::int as in_stock,
               count(p.id) filter (where p.active = true and coalesce(p.price_ugx,0) <= 0)::int as unpriced
        from categories c
        left join products p on p.category_id = c.id
        where ${wanted === null ? sql`true` : pgInTextList(sql`c.slug`, wanted)}
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

    // ── Source-state resolution and dependency planning ─────────────────────

    async loadUniverse() {
      const rows = rowsOf(await conn.execute(sql`select slug from categories order by slug limit 500`));
      return rows.map((r) => ({ entityType: 'CATEGORY' as const, entityId: `/${String(r.slug)}` }));
    },

    async resolveChanges() {
      const ports: SourceStatePorts = {
        now: async () => String(rowsOf(await conn.execute(sql`select now()::text as t`))[0]?.t ?? ''),

        readCursor: async (key) => {
          const row = rowsOf(await conn.execute(sql`
            select cursor_at::text as at, cursor_id from seo_intel_source_cursors where source_key = ${key}
          `))[0];
          return { at: row?.at ? String(row.at) : null, id: row?.cursor_id ? String(row.cursor_id) : null };
        },

        readKnownState: async (key) => {
          const rows = rowsOf(await conn.execute(sql`
            select entity_id, state_hash from seo_intel_source_state where source_key = ${key}
          `));
          return new Map(rows.map((r) => [String(r.entity_id), String(r.state_hash)]));
        },

        readSince: async (d, lower, upperBound) => {
          if (d.key === 'products') {
            // Composite (updated_at, id) comparison: rows sharing an instant
            // are ordered by id so none is skipped.
            const rows = rowsOf(await conn.execute(sql`
              select id::text as id, updated_at::text as at,
                     active, approval_status, stock_status, stock_quantity, price_ugx,
                     has_retail_price, category_id::text as category_id
              from products
              where updated_at <= ${upperBound}::timestamptz
                and (${lower.at === null ? sql`true` : sql`
                  (updated_at > ${lower.at}::timestamptz
                   or (updated_at = ${lower.at}::timestamptz and id::text > ${lower.id ?? ''}))`})
              order by updated_at, id
              limit 5000
            `));
            return rows.map((r) => ({
              id: String(r.id), at: String(r.at),
              stateHash: stateHashOf({
                active: r.active, approval: r.approval_status, stock: r.stock_status,
                qty: r.stock_quantity, price: r.price_ugx, retail: r.has_retail_price,
                category: r.category_id,
              }),
            }));
          }
          if (d.key === 'seo_change_ledger') {
            const rows = rowsOf(await conn.execute(sql`
              select id::text as id, occurred_at::text as at, target, scope, validation_state
              from seo_change_ledger
              where occurred_at <= ${upperBound}::timestamptz
                and (${lower.at === null ? sql`true` : sql`
                  (occurred_at > ${lower.at}::timestamptz
                   or (occurred_at = ${lower.at}::timestamptz and id::text > ${lower.id ?? ''}))`})
              order by occurred_at, id
              limit 5000
            `));
            return rows.map((r) => ({
              id: String(r.target), at: String(r.at),
              stateHash: stateHashOf({ scope: r.scope, state: r.validation_state, id: r.id }),
            }));
          }
          if (d.key === 'seo_queries') {
            const rows = rowsOf(await conn.execute(sql`
              select id::text as id, last_observed_at::text as at, query, intent, evidence_state, source
              from seo_queries
              where last_observed_at is not null
                and last_observed_at <= ${upperBound}::timestamptz
                and (${lower.at === null ? sql`true` : sql`
                  (last_observed_at > ${lower.at}::timestamptz
                   or (last_observed_at = ${lower.at}::timestamptz and id::text > ${lower.id ?? ''}))`})
              order by last_observed_at, id
              limit 5000
            `));
            return rows.map((r) => ({
              id: String(r.query), at: String(r.at),
              stateHash: stateHashOf({ intent: r.intent, evidence: r.evidence_state }),
              // A CSV import or operator entry describes the past, so it must
              // not be read as a new current SEO event.
              historical: String(r.source) === 'CSV_IMPORT' || String(r.source) === 'OPERATOR',
            }));
          }
          return [];
        },

        readInventory: async (d) => {
          if (d.key === 'categories') {
            // categories has no timestamp column at all, so the full observed
            // state IS the change evidence.
            const rows = rowsOf(await conn.execute(sql`
              select c.id::text as id, c.slug, c.name,
                     count(p.id) filter (where p.active = true and p.approval_status = 'approved')::int as eligible
              from categories c left join products p on p.category_id = c.id
              group by c.id, c.slug, c.name limit 500
            `));
            return rows.map((r) => ({
              id: `/${String(r.slug)}`, at: null,
              stateHash: stateHashOf({ name: r.name, slug: r.slug, eligible: r.eligible }),
            }));
          }
          if (d.key === 'products') {
            const rows = rowsOf(await conn.execute(sql`select id::text as id from products limit 20000`));
            return rows.map((r) => ({ id: String(r.id), at: null, stateHash: '' }));
          }
          return [];
        },
      };

      const snapshot = await resolveSourceChanges(ports);

      return {
        snapshotId: snapshot.snapshotId,
        changes: snapshot.changes,
        coverageLimits: snapshot.coverageLimits,
        // Committed only by the coordinator, and only after the whole run
        // succeeded.
        commit: async () => {
          for (const [key, cur] of Object.entries(snapshot.proposedCursors)) {
            await conn.execute(sql`
              insert into seo_intel_source_cursors (source_key, cursor_at, cursor_id, snapshot_id, updated_at)
              values (${key}, ${cur.at}::timestamptz, ${cur.id}, ${snapshot.snapshotId}, now())
              on conflict (source_key) do update set
                cursor_at = excluded.cursor_at, cursor_id = excluded.cursor_id,
                snapshot_id = excluded.snapshot_id, updated_at = now()
            `);
          }
          for (const [key, state] of Object.entries(snapshot.proposedState)) {
            for (const [entityId, hash] of state) {
              await conn.execute(sql`
                insert into seo_intel_source_state (source_key, entity_id, state_hash, updated_at)
                values (${key}, ${entityId}, ${hash}, now())
                on conflict (source_key, entity_id) do update set
                  state_hash = excluded.state_hash, updated_at = now()
              `);
            }
          }
        },
      };
    },

    async dependencyResolver() {
      // Loaded once per run: the graph is small and a per-lookup query would
      // turn planning into N round-trips.
      const prodCats = rowsOf(await conn.execute(sql`
        select p.id::text as product_id, c.slug from products p
        join categories c on c.id = p.category_id limit 20000
      `));
      const byProduct = new Map<string, string[]>();
      for (const r of prodCats) {
        const k = String(r.product_id);
        if (!byProduct.has(k)) byProduct.set(k, []);
        byProduct.get(k)!.push(`/${String(r.slug)}`);
      }

      const clusterByUrl = new Map<string, string[]>();
      for (const r of rowsOf(await conn.execute(sql`
        select cluster_key, preferred_owner_url from seo_intel_clusters where preferred_owner_url is not null
      `))) {
        const u = String(r.preferred_owner_url);
        if (!clusterByUrl.has(u)) clusterByUrl.set(u, []);
        clusterByUrl.get(u)!.push(String(r.cluster_key));
      }

      const answersByFact = new Map<string, string[]>();
      for (const r of rowsOf(await conn.execute(sql`
        select answer_key, fact_hash from seo_intel_answer_units
      `))) {
        const f = String(r.fact_hash);
        if (!answersByFact.has(f)) answersByFact.set(f, []);
        answersByFact.get(f)!.push(String(r.answer_key));
      }

      return {
        categoriesForProduct: (id) => byProduct.get(id) ?? [],
        // A category entity IS its URL in this model; a product has no
        // standalone indexable route yet, so it contributes through its
        // categories rather than inventing one.
        urlsForEntity: (ref) => (ref.entityType === 'CATEGORY' ? [ref.entityId] : []),
        clustersForUrl: (url) => clusterByUrl.get(url) ?? [],
        answerUnitsForFact: (fact) => answersByFact.get(fact) ?? [],
        linkSourcesForUrl: () => [],
      };
    },

    // ── Query intelligence ──────────────────────────────────────────────────

    async loadQueryUniverse() {
      // Queries come from whatever providers are actually connected. There is
      // no synthetic fallback: an empty universe is reported as empty, and the
      // coordinator renders that as provider absence rather than zero demand.
      const queries = rowsOf(await conn.execute(sql`
        select query as raw, source, last_observed_at::text as observed_at,
               -- A CSV import is historical by nature; it must never read as a
               -- live observation.
               (source in ('CSV_IMPORT','OPERATOR')) as is_backfill
        from seo_queries
        where query is not null and query <> ''
        order by last_observed_at desc nulls last
        limit 5000
      `)).map((r) => ({
        raw: String(r.raw),
        source: String(r.source),
        observedAt: r.observed_at ? String(r.observed_at) : null,
        isBackfill: Boolean(r.is_backfill),
      }));

      // Entities give clustering something concrete to attach queries to, so a
      // cluster can name a real category rather than a token bag.
      const entities = rowsOf(await conn.execute(sql`
        select id::text as entity_id, name, slug from categories limit 500
      `)).map((r) => ({
        entityId: String(r.entity_id),
        entityType: 'CATEGORY' as const,
        label: String(r.name ?? r.slug ?? ''),
        terms: String(r.name ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
      }));

      return { queries, entities };
    },

    async loadClusterHashes(keys) {
      if (keys.length === 0) return new Map();
      const rows = rowsOf(await conn.execute(sql`
        select cluster_key, membership_signature from seo_intel_clusters
        where ${pgInTextList(sql`cluster_key`, keys)}
      `));
      return new Map(rows.map((r) => [String(r.cluster_key), String(r.membership_signature ?? '')]));
    },

    async upsertCluster(i) {
      const before = rowsOf(await conn.execute(sql`
        select membership_signature from seo_intel_clusters where cluster_key = ${i.clusterKey}
      `))[0]?.membership_signature ?? null;

      await conn.execute(sql`
        insert into seo_intel_clusters (
          cluster_key, label, cluster_method, cluster_confidence, membership_signature, member_count,
          entity_id, entity_type, primary_intent, secondary_intent, intent_confidence, intent_method,
          current_owner_url, current_owner_type, preferred_owner_url, preferred_owner_type,
          ownership_decision, ownership_rationale, last_seen_at, updated_at
        ) values (
          ${i.clusterKey}, ${i.label}, ${i.method}, ${i.confidence}, ${i.membershipSignature}, ${i.memberCount},
          ${i.entityId}, ${i.entityType}, ${i.primaryIntent}, ${i.secondaryIntent}, ${i.intentConfidence}, ${i.intentMethod},
          ${i.currentOwnerUrl}, ${i.currentOwnerType}, ${i.preferredOwnerUrl}, ${i.preferredOwnerType},
          ${i.ownershipDecision}, ${i.ownershipRationale}, now(), now()
        )
        on conflict (cluster_key) do update set
          label = excluded.label, cluster_method = excluded.cluster_method,
          cluster_confidence = excluded.cluster_confidence,
          membership_signature = excluded.membership_signature, member_count = excluded.member_count,
          entity_id = excluded.entity_id, entity_type = excluded.entity_type,
          primary_intent = excluded.primary_intent, secondary_intent = excluded.secondary_intent,
          intent_confidence = excluded.intent_confidence, intent_method = excluded.intent_method,
          current_owner_url = excluded.current_owner_url, current_owner_type = excluded.current_owner_type,
          preferred_owner_url = excluded.preferred_owner_url, preferred_owner_type = excluded.preferred_owner_type,
          ownership_decision = excluded.ownership_decision, ownership_rationale = excluded.ownership_rationale,
          last_seen_at = now(),
          -- Freshness is not a change. updated_at only moves when the
          -- membership signature actually differs.
          updated_at = case
            when seo_intel_clusters.membership_signature is distinct from excluded.membership_signature
            then now() else seo_intel_clusters.updated_at end
      `);
      return { changed: before !== i.membershipSignature };
    },

    async loadMembershipKeys(clusterKeys) {
      if (clusterKeys.length === 0) return new Set();
      const rows = rowsOf(await conn.execute(sql`
        select membership_key from seo_intel_query_membership
        where ${pgInTextList(sql`cluster_key`, clusterKeys)}
      `));
      return new Set(rows.map((r) => String(r.membership_key)));
    },

    async upsertQueryMembership(i) {
      const res = rowsOf(await conn.execute(sql`
        insert into seo_intel_query_membership (
          membership_key, cluster_key, raw_query, normalized_query, membership_method,
          membership_confidence, source, source_observed_at, is_backfill, demand_state, last_seen_at
        ) values (
          ${i.membershipKey}, ${i.clusterKey}, ${i.rawQuery}, ${i.normalizedQuery}, ${i.method},
          ${i.confidence}, ${i.source}, ${i.observedAt}, ${i.isBackfill},
          -- Placement does not measure demand. impressions/clicks stay NULL and
          -- the CHECK constraint enforces that pairing.
          'UNKNOWN', now()
        )
        on conflict (membership_key) do update set
          membership_confidence = excluded.membership_confidence,
          last_seen_at = now()
        returning (xmax = 0) as inserted
      `));
      return { changed: Boolean(res[0]?.inserted) };
    },

    async loadCompetingUrls(clusterKeys) {
      const out = new Map<string, any[]>();
      if (clusterKeys.length === 0) return out;
      // Competition is only observable where a page is actually indexable and
      // alive. A noindexed or retired URL is not competing for anything.
      const rows = rowsOf(await conn.execute(sql`
        select distinct m.cluster_key, p.final_url as url,
               -- Demand is NOT stored per URL by any connected provider, so it
               -- stays NULL. Writing 0 here would fabricate a measurement.
               null::int as impressions, null::int as clicks,
               p.canonical as canonical_target
        from seo_intel_query_membership m
        join seo_crawl_pages p
          on position(lower(m.normalized_query) in lower(coalesce(p.final_url, ''))) > 0
        where ${pgInTextList(sql`m.cluster_key`, clusterKeys)}
          -- A noindexed page is not competing for anything.
          and coalesce(p.meta_robots, '') not ilike '%noindex%'
        limit 2000
      `));
      for (const r of rows) {
        const key = String(r.cluster_key);
        if (!out.has(key)) out.set(key, []);
        out.get(key)!.push({
          url: String(r.url),
          impressions: r.impressions === null ? null : Number(r.impressions),
          clicks: r.clicks === null ? null : Number(r.clicks),
          intent: 'UNKNOWN' as never,
          ownerType: null,
          canonicalTarget: r.canonical_target ? String(r.canonical_target) : null,
          contentSimilarity: null,
          // Reached only via the indexable filter above.
          lifecycleActive: true,
        });
      }
      return out;
    },

    async loadCannibalisationHashes(keys) {
      if (keys.length === 0) return new Map();
      const rows = rowsOf(await conn.execute(sql`
        select finding_key, classification, rationale from seo_intel_cannibalisation
        where ${pgInTextList(sql`finding_key`, keys)}
      `));
      return new Map(rows.map((r) => [String(r.finding_key), String(r.classification ?? '')]));
    },

    async upsertCannibalisation(i) {
      const res = rowsOf(await conn.execute(sql`
        insert into seo_intel_cannibalisation (
          finding_key, cluster_key, classification, confidence, rationale,
          affected_urls, persistence, status, last_seen_at, last_material_change_at
        ) values (
          ${i.findingKey}, ${i.clusterKey}, ${i.classification}, ${i.confidence}, ${i.rationale},
          ${pgJsonb(i.affectedUrls)}, ${i.persistence}, 'OPEN', now(), now()
        )
        on conflict (finding_key) do update set
          confidence = excluded.confidence, rationale = excluded.rationale,
          affected_urls = excluded.affected_urls,
          persistence = seo_intel_cannibalisation.persistence + 1,
          last_seen_at = now(),
          last_material_change_at = case
            when seo_intel_cannibalisation.classification is distinct from excluded.classification
            then now() else seo_intel_cannibalisation.last_material_change_at end
        returning (xmax = 0) as inserted
      `));
      return { changed: Boolean(res[0]?.inserted) };
    },

    // ── Answer units (AEO) ──────────────────────────────────────────────────

    /**
     * Drafts built from catalogue truth. A fact is only offered here while the
     * underlying row still supports it — when a product is deactivated or its
     * price removed, the fact simply stops appearing, which is what drives the
     * answer unit out of READY on the next run.
     */
    async loadAnswerUnitDrafts(affectedKeys) {
      const rows = rowsOf(await conn.execute(sql`
        select p.id::text as product_id, p.name, p.slug,
               p.price_ugx, p.stock_quantity, p.active, p.approval_status,
               c.slug as category_slug
        from products p
        left join categories c on c.id = p.category_id
        where p.active = true and p.approval_status = 'approved'
        limit 2000
      `));

      const drafts = rows.map((r) => {
        const productId = String(r.product_id);
        const facts: Array<{ key: string; value: string; source: string; sourceId: string; verified: boolean }> = [];

        // Price is a fact only while the catalogue actually carries one. A
        // missing price must not become "0" — it must be absent.
        if (r.price_ugx !== null && Number(r.price_ugx) > 0) {
          facts.push({
            key: `price:${productId}`, value: String(r.price_ugx),
            source: 'CATALOGUE', sourceId: productId, verified: true,
          });
        }
        if (r.stock_quantity !== null) {
          facts.push({
            key: `availability:${productId}`, value: String(r.stock_quantity),
            source: 'CATALOGUE', sourceId: productId, verified: true,
          });
        }

        return {
          templateId: 'product-availability',
          entityContext: String(r.slug),
          question: `Is ${String(r.name)} available at GoldPlus, and what does it cost?`,
          intent: 'PRICE',
          answerType: 'PRICE' as never,
          // Both facts are required: an answer that states availability without
          // a price is not the answer to this question.
          requiredFactKeys: [`price:${productId}`, `availability:${productId}`],
          availableFacts: facts as never,
          productEntities: [productId],
          categoryEntities: r.category_slug ? [`/${String(r.category_slug)}`] : [],
        };
      });

      if (affectedKeys === null) return drafts as never;
      // Incremental: only the units the planner marked as fact-affected.
      const wanted = new Set(affectedKeys);
      return drafts.filter((d) => wanted.has(`${d.templateId}::${d.entityContext}`)) as never;
    },

    // ── Content intelligence ────────────────────────────────────────────────

    async loadContentHashes(keys) {
      if (keys.length === 0) return new Map();
      const rows = rowsOf(await conn.execute(sql`
        select content_key, semantic_hash from seo_intel_content
        where ${pgInTextList(sql`content_key`, keys)}
      `));
      return new Map(rows.map((r) => [String(r.content_key), String(r.semantic_hash)]));
    },

    async upsertContentIntelligence(i) {
      const res = rowsOf(await conn.execute(sql`
        insert into seo_intel_content (
          content_key, url, classification, primary_intent, cluster_key,
          content_completeness, semantic_hash, last_seen_at, last_material_change_at
        ) values (
          ${i.contentKey}, ${i.url}, ${i.classification}, ${i.primaryIntent}, ${i.clusterKey},
          ${i.contentCompleteness}, ${i.semanticHash}, now(), now()
        )
        on conflict (content_key) do update set
          classification = excluded.classification, primary_intent = excluded.primary_intent,
          cluster_key = excluded.cluster_key, content_completeness = excluded.content_completeness,
          semantic_hash = excluded.semantic_hash, last_seen_at = now(),
          last_material_change_at = case
            when seo_intel_content.semantic_hash is distinct from excluded.semantic_hash
            then now() else seo_intel_content.last_material_change_at end
        returning (xmax = 0) as inserted
      `));
      return { changed: Boolean(res[0]?.inserted) };
    },

    // ── Action requests (recorded, never executed) ───────────────────────────

    async upsertActionRequest(i) {
      const res = rowsOf(await conn.execute(sql`
        insert into seo_intel_action_requests (
          request_key, opportunity_key, action_class, entity_id, evidence_ids,
          policy_version, preconditions, unmet_preconditions, confidence, blast_radius,
          expected_effect, rollback_class, verification_plan, state, decision_reason, updated_at
        ) values (
          ${i.requestKey}, ${i.opportunityKey}, ${i.actionClass}, ${i.entityId}, ${pgJsonb(i.evidenceIds)},
          ${i.policyVersion}, ${pgJsonb(i.preconditions)}, ${pgJsonb(i.unmetPreconditions)}, ${i.confidence}, ${i.blastRadius},
          ${i.expectedEffect}, ${i.rollbackClass}, ${i.verificationPlan}, ${i.state}, ${i.decisionReason}, now()
        )
        on conflict (request_key) do update set
          state = excluded.state, decision_reason = excluded.decision_reason,
          unmet_preconditions = excluded.unmet_preconditions, updated_at = now()
        returning (xmax = 0) as inserted
      `));
      return { changed: Boolean(res[0]?.inserted) };
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
