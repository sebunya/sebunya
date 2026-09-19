import { sql, type SQL } from 'drizzle-orm';
import { db } from '../client';
import { pgJsonb, pgUuidArray } from '../PgParams';
import type {
  AiVisibilityRepository, AivAction, AivCitationRow, AivCompetitor, AivMentionRow, AivObservationRow, AivProject,
  AivProviderConfig, AivQuery, AivRun, NewObservation, ObservationFilter, Page,
} from '../../../application/ports/AiVisibility';
import type { ProviderId } from '../../../domain/ai-visibility/Evidence';
import type { ActionStatus, ActorKind } from '../../../domain/ai-visibility/Actions';
import type { RunStatus } from '../../../domain/ai-visibility/RunLifecycle';

/**
 * AI Search Visibility data access (migration 0131). Raw SQL via db.execute,
 * house style of the SEO repositories. Observations, citations and mentions
 * are insert-only. Every status change is a compare-and-set.
 */
const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : (r as any)?.rows ?? []);
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const nn = (v: unknown): number | null => (v == null ? null : Number(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const project = (r: any): AivProject => ({
  id: r.id, slug: r.slug, name: r.name, brandName: r.brand_name, brandAliases: arr(r.brand_aliases), domains: arr(r.domains),
  marketCountry: r.market_country, marketCity: r.market_city, language: r.language,
  budget: { maxQueriesPerRun: n(r.max_queries_per_run), maxSpendPerRunUsd: n(r.max_spend_per_run_usd), maxDailySpendUsd: n(r.max_daily_spend_usd), maxMonthlySpendUsd: n(r.max_monthly_spend_usd), approvalAboveUsd: n(r.approval_above_usd) },
  schedule: { monitor: r.monitor_schedule ?? 'OFF', setBy: r.schedule_set_by ?? null, lastScheduledAt: iso(r.last_scheduled_at) },
});
const competitor = (r: any): AivCompetitor => ({ id: r.id, name: r.canonical_name, aliases: arr(r.aliases), domains: arr(r.domains), businessType: r.business_type ?? null, directness: r.directness ?? null });
const providerCfg = (r: any): AivProviderConfig => ({
  id: r.id, provider: r.provider, enabled: !!r.enabled, model: r.model, webSearch: !!r.web_search, estUsdPerCall: n(r.est_usd_per_call),
  monthlyCapUsd: nn(r.monthly_cap_usd), hasCredential: !!r.credential_ciphertext, credentialMask: r.credential_mask ?? null,
  credentialUpdatedAt: iso(r.credential_updated_at), lastHealthStatus: r.last_health_status ?? null, lastHealthMessage: r.last_health_message ?? null, lastHealthAt: iso(r.last_health_at),
});
const query = (r: any): AivQuery => ({
  id: r.id, text: r.text, category: r.category, intent: r.intent, funnelStage: r.funnel_stage, branded: !!r.branded, topic: r.topic, property: r.property,
  marketCountry: r.market_country, marketCity: r.market_city, language: r.language, source: r.source, provenance: r.provenance, priority: r.priority,
  tags: arr(r.tags), active: !!r.active, createdAt: iso(r.created_at) as string,
});
const run = (r: any): AivRun => ({
  id: r.id, projectId: r.project_id, kind: r.kind, status: r.status, idempotencyKey: r.idempotency_key, providers: arr(r.providers) as ProviderId[],
  queryIds: arr(r.query_ids), adhocQueries: arr(r.adhoc_queries), totalTasks: n(r.total_tasks), succeeded: n(r.succeeded), failed: n(r.failed), skipped: n(r.skipped),
  estimatedUsd: n(r.estimated_usd), actualUsd: n(r.actual_usd), phase: r.phase, error: r.error, requestedBy: r.requested_by, actorKind: r.actor_kind,
  approvedBy: r.approved_by, actionId: r.action_id, overThreshold: r.over_threshold !== false, cancelRequested: !!r.cancel_requested, createdAt: iso(r.created_at) as string, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
});
const obs = (r: any): AivObservationRow => ({
  id: r.id, runId: r.run_id, runKind: r.run_kind, queryId: r.query_id, queryText: r.query_text, provider: r.provider, model: r.model, status: r.status,
  errorCode: r.error_code, errorMessage: r.error_message, citationSupport: r.citation_support, brandMentioned: r.brand_mentioned, ownCited: r.own_cited,
  citationCount: n(r.citation_count), costUsd: nn(r.cost_usd), latencyMs: nn(r.latency_ms), requestedLocation: r.requested_location, appliedLocation: r.applied_location, executedAt: iso(r.executed_at) as string,
});
const action = (r: any): AivAction => ({
  id: r.id, projectId: r.project_id, category: r.category, risk: r.risk, status: r.status, title: r.title, reason: r.reason, mechanism: r.mechanism, plan: r.plan,
  targetPage: r.target_page, expectedImpact: r.expected_impact, limitations: r.limitations, confidence: r.confidence, evidence: r.evidence ?? {}, queryIds: arr(r.query_ids),
  baseline: r.baseline ?? null, verification: r.verification ?? null, result: r.result, rollback: r.rollback, proposedBy: r.proposed_by, proposerKind: r.proposer_kind,
  approvedBy: r.approved_by, approvedAt: iso(r.approved_at), executedBy: r.executed_by, executedAt: iso(r.executed_at), verifyAfter: iso(r.verify_after),
  createdAt: iso(r.created_at) as string, updatedAt: iso(r.updated_at) as string,
});
const page = <T>(rows: T[], total: number, limit: number, offset: number): Page<T> => ({ rows, total, limit, offset });
const lim = (l: number, max = 200) => Math.min(Math.max(Math.trunc(l) || 50, 1), max);
const off = (o: number) => Math.max(Math.trunc(o) || 0, 0);
/** A project id or slug; ids are matched as uuid only when they look like one. */
const projectKey = (idOrSlug: string): SQL => (UUID.test(idOrSlug) ? sql`(id = ${idOrSlug}::uuid or slug = ${idOrSlug})` : sql`slug = ${idOrSlug}`);

export class DrizzleAiVisibilityRepository implements AiVisibilityRepository {
  async listProjects() { return rowsOf(await db.execute(sql`select * from aiv_projects order by name`)).map(project); }

  async getProject(idOrSlug: string) {
    const r = rowsOf(await db.execute(sql`select * from aiv_projects where ${projectKey(idOrSlug)} limit 1`))[0];
    return r ? project(r) : null;
  }

  async createProject(i: { slug: string; name: string; brandName: string; brandAliases: string[]; domains: string[]; marketCountry: string; marketCity: string | null }) {
    const r = rowsOf(await db.execute(sql`
      insert into aiv_projects (slug, name, brand_name, brand_aliases, domains, market_country, market_city)
      values (${i.slug}, ${i.name}, ${i.brandName}, ${pgJsonb(i.brandAliases)}, ${pgJsonb(i.domains)}, ${i.marketCountry}, ${i.marketCity}) returning *`))[0];
    await db.execute(sql`
      insert into aiv_provider_configs (project_id, provider, model, est_usd_per_call)
      select ${r.id}::uuid, v.provider, v.model, v.est from (values ('OPENAI','gpt-4.1-mini',0.04), ('ANTHROPIC','claude-sonnet-5',0.05), ('GEMINI','gemini-2.5-flash',0.04), ('PERPLEXITY','sonar',0.02)) as v(provider, model, est)
      on conflict (project_id, provider) do nothing`);
    return project(r);
  }

  async updateProject(id: string, p: Parameters<AiVisibilityRepository['updateProject']>[1]) {
    const b = p.budget;
    const r = rowsOf(await db.execute(sql`
      update aiv_projects set
        name = coalesce(${p.name ?? null}, name),
        brand_name = coalesce(${p.brandName ?? null}, brand_name),
        brand_aliases = coalesce(${p.brandAliases ? pgJsonb(p.brandAliases) : null}, brand_aliases),
        domains = coalesce(${p.domains ? pgJsonb(p.domains) : null}, domains),
        market_country = coalesce(${p.marketCountry ?? null}, market_country),
        market_city = ${p.marketCity !== undefined ? sql`${p.marketCity}` : sql`market_city`},
        max_queries_per_run = coalesce(${b?.maxQueriesPerRun ?? null}, max_queries_per_run),
        max_spend_per_run_usd = coalesce(${b?.maxSpendPerRunUsd ?? null}, max_spend_per_run_usd),
        max_daily_spend_usd = coalesce(${b?.maxDailySpendUsd ?? null}, max_daily_spend_usd),
        max_monthly_spend_usd = coalesce(${b?.maxMonthlySpendUsd ?? null}, max_monthly_spend_usd),
        approval_above_usd = coalesce(${b?.approvalAboveUsd ?? null}, approval_above_usd),
        monitor_schedule = coalesce(${p.schedule?.monitor ?? null}, monitor_schedule),
        schedule_set_by = ${p.schedule ? (p.schedule.setBy && UUID.test(p.schedule.setBy) ? sql`${p.schedule.setBy}::uuid` : sql`null`) : sql`schedule_set_by`},
        updated_at = now()
      where id = ${id}::uuid returning *`))[0];
    return r ? project(r) : null;
  }

  async dueScheduledProjects(nowIso: string) {
    return rowsOf(await db.execute(sql`
      select * from aiv_projects
      where (monitor_schedule = 'DAILY' and (last_scheduled_at is null or last_scheduled_at < ${nowIso}::timestamptz - interval '23 hours'))
         or (monitor_schedule = 'WEEKLY' and (last_scheduled_at is null or last_scheduled_at < ${nowIso}::timestamptz - interval '6 days 23 hours'))`)).map(project);
  }
  async markScheduled(projectId: string) {
    await db.execute(sql`update aiv_projects set last_scheduled_at = now() where id = ${projectId}::uuid`);
  }

  async listPinnedCompetitors(projectId: string) {
    return rowsOf(await db.execute(sql`
      select c.* from aiv_project_competitors pc join seo_competitors c on c.id = pc.competitor_id
      where pc.project_id = ${projectId}::uuid order by c.canonical_name`)).map(competitor);
  }
  async listRegistryCompetitors() {
    return rowsOf(await db.execute(sql`select * from seo_competitors where status = 'ACTIVE' order by canonical_name`)).map(competitor);
  }
  async pinCompetitor(projectId: string, competitorId: string) {
    const r = rowsOf(await db.execute(sql`insert into aiv_project_competitors (project_id, competitor_id) values (${projectId}::uuid, ${competitorId}::uuid) on conflict do nothing returning project_id`));
    return r.length > 0;
  }
  async unpinCompetitor(projectId: string, competitorId: string) {
    const r = rowsOf(await db.execute(sql`delete from aiv_project_competitors where project_id = ${projectId}::uuid and competitor_id = ${competitorId}::uuid returning project_id`));
    return r.length > 0;
  }

  async listQueries(projectId: string, f: { active?: boolean; search?: string; limit: number; offset: number }) {
    const where: SQL[] = [sql`project_id = ${projectId}::uuid`];
    if (f.active !== undefined) where.push(sql`active = ${f.active}`);
    if (f.search) where.push(sql`normalized_text like ${'%' + f.search.toLowerCase().replace(/[%_\\]/g, (c) => '\\' + c) + '%'}`);
    const w = sql.join(where, sql` and `);
    const [rows, total] = await Promise.all([
      db.execute(sql`select * from aiv_queries where ${w} order by priority, text limit ${lim(f.limit, 1000)} offset ${off(f.offset)}`),
      db.execute(sql`select count(*)::int as n from aiv_queries where ${w}`),
    ]);
    return page(rowsOf(rows).map(query), n(rowsOf(total)[0]?.n), lim(f.limit, 1000), off(f.offset));
  }
  async getQueries(projectId: string, ids: readonly string[]) {
    if (ids.length === 0) return [];
    return rowsOf(await db.execute(sql`select * from aiv_queries where project_id = ${projectId}::uuid and id = any(${pgUuidArray(ids)})`)).map(query);
  }
  async createQuery(projectId: string, q: Omit<AivQuery, 'id' | 'createdAt'> & { createdBy: string | null }) {
    const r = rowsOf(await db.execute(sql`
      insert into aiv_queries (project_id, text, normalized_text, category, intent, funnel_stage, branded, topic, property, market_country, market_city, language, source, provenance, priority, tags, active, created_by)
      values (${projectId}::uuid, ${q.text}, ${q.text.toLowerCase()}, ${q.category}, ${q.intent}, ${q.funnelStage}, ${q.branded}, ${q.topic}, ${q.property}, ${q.marketCountry}, ${q.marketCity}, ${q.language}, ${q.source}, ${q.provenance}, ${q.priority}, ${pgJsonb(q.tags)}, ${q.active}, ${q.createdBy && UUID.test(q.createdBy) ? sql`${q.createdBy}::uuid` : sql`null`})
      on conflict (project_id, normalized_text) do nothing returning *`))[0];
    return r ? query(r) : null;
  }
  async updateQuery(projectId: string, id: string, p: Partial<Omit<AivQuery, 'id' | 'createdAt'>>) {
    const set = (col: string, v: unknown) => (v === undefined ? null : sql`${sql.raw(col)} = ${v as never}`);
    const parts = [
      p.text !== undefined ? sql`text = ${p.text}, normalized_text = ${p.text.toLowerCase()}` : null,
      set('category', p.category), set('intent', p.intent), set('funnel_stage', p.funnelStage), set('branded', p.branded), set('topic', p.topic),
      set('property', p.property), set('market_country', p.marketCountry), set('market_city', p.marketCity), set('language', p.language),
      set('source', p.source), set('provenance', p.provenance), set('priority', p.priority), set('active', p.active),
      p.tags !== undefined ? sql`tags = ${pgJsonb(p.tags)}` : null,
    ].filter(Boolean) as SQL[];
    try {
      const r = rowsOf(await db.execute(sql`update aiv_queries set ${sql.join([...parts, sql`updated_at = now()`], sql`, `)} where id = ${id}::uuid and project_id = ${projectId}::uuid returning *`))[0];
      return r ? query(r) : null;
    } catch {
      return null; // unique (project, text) violation: the new text duplicates another query
    }
  }

  async listProviderConfigs(projectId: string) {
    return rowsOf(await db.execute(sql`select * from aiv_provider_configs where project_id = ${projectId}::uuid order by provider`)).map(providerCfg);
  }
  async getProviderCredential(projectId: string, provider: ProviderId) {
    const r = rowsOf(await db.execute(sql`select credential_ciphertext from aiv_provider_configs where project_id = ${projectId}::uuid and provider = ${provider}`))[0];
    return r?.credential_ciphertext ?? null;
  }
  async updateProviderConfig(projectId: string, provider: ProviderId, p: Partial<Pick<AivProviderConfig, 'enabled' | 'model' | 'webSearch' | 'estUsdPerCall' | 'monthlyCapUsd'>>) {
    const r = rowsOf(await db.execute(sql`
      update aiv_provider_configs set
        enabled = coalesce(${p.enabled ?? null}, enabled),
        model = coalesce(${p.model ?? null}, model),
        web_search = coalesce(${p.webSearch ?? null}, web_search),
        est_usd_per_call = coalesce(${p.estUsdPerCall ?? null}, est_usd_per_call),
        monthly_cap_usd = ${p.monthlyCapUsd !== undefined ? sql`${p.monthlyCapUsd}` : sql`monthly_cap_usd`},
        updated_at = now()
      where project_id = ${projectId}::uuid and provider = ${provider} returning *`))[0];
    return r ? providerCfg(r) : null;
  }
  async setProviderCredential(projectId: string, provider: ProviderId, ciphertext: string | null, mask: string | null) {
    await db.execute(sql`update aiv_provider_configs set credential_ciphertext = ${ciphertext}, credential_mask = ${mask}, credential_updated_at = now(),
      last_health_status = null, last_health_message = null, last_health_at = null, updated_at = now()
      where project_id = ${projectId}::uuid and provider = ${provider}`);
  }
  async recordProviderHealth(projectId: string, provider: ProviderId, status: 'OK' | 'FAILED', message: string) {
    await db.execute(sql`update aiv_provider_configs set last_health_status = ${status}, last_health_message = ${message.slice(0, 500)}, last_health_at = now() where project_id = ${projectId}::uuid and provider = ${provider}`);
  }

  async spendToDate(projectId: string) {
    // Answers that succeeded, failures recorded as possibly billed (cost set),
    // and ledger entries (provider tests) — every cost, one sum.
    const rows = rowsOf(await db.execute(sql`
      select provider,
        coalesce(sum(cost_usd) filter (where at >= date_trunc('day', now())), 0) as today,
        coalesce(sum(cost_usd), 0) as month
      from (
        select provider, cost_usd, executed_at as at from aiv_observations
          where project_id = ${projectId}::uuid and cost_usd is not null and executed_at >= date_trunc('month', now())
        union all
        select provider, cost_usd, created_at as at from aiv_spend_ledger
          where project_id = ${projectId}::uuid and created_at >= date_trunc('month', now())
      ) s group by provider`));
    const providerMonthUsd: Record<string, number> = {};
    let todayUsd = 0, monthUsd = 0;
    for (const r of rows) { providerMonthUsd[r.provider] = n(r.month); todayUsd += n(r.today); monthUsd += n(r.month); }
    return { todayUsd, monthUsd, providerMonthUsd };
  }
  async recordSpend(e: { projectId: string; provider: ProviderId; kind: 'PROVIDER_TEST'; costUsd: number; basis: 'PROVIDER_REPORTED' | 'ESTIMATE_PER_CALL'; actorId: string | null }) {
    await db.execute(sql`insert into aiv_spend_ledger (project_id, provider, kind, cost_usd, basis, actor_id)
      values (${e.projectId}::uuid, ${e.provider}, ${e.kind}, ${e.costUsd}, ${e.basis}, ${e.actorId && UUID.test(e.actorId) ? sql`${e.actorId}::uuid` : sql`null`})`);
  }
  async listEvidenceForReclassification(projectId: string, afterId: string | null, limit: number) {
    const rows = rowsOf(await db.execute(sql`
      select o.id, o.provider, o.model, o.query_text, o.latency_ms, o.raw_metadata -> 'rawResponse' as raw_response, o.answer_text, o.citation_support,
        coalesce((select jsonb_agg(jsonb_build_object('url', c.url, 'title', c.title, 'position', c.position) order by c.position)
                  from aiv_citations c where c.observation_id = o.id), '[]'::jsonb) as citations
      from aiv_observations o
      where o.project_id = ${projectId}::uuid and o.status = 'SUCCEEDED' ${afterId && UUID.test(afterId) ? sql`and o.id > ${afterId}::uuid` : sql``}
      order by o.id limit ${Math.min(Math.max(limit, 1), 500)}`));
    return rows.map((r) => ({ id: String(r.id), provider: r.provider, model: r.model, queryText: r.query_text, latencyMs: nn(r.latency_ms), rawResponse: r.raw_response ?? null, answerText: r.answer_text, citationSupport: r.citation_support, citations: Array.isArray(r.citations) ? r.citations : [] }));
  }
  async replaceClassification(o: Parameters<AiVisibilityRepository['replaceClassification']>[0]) {
    return db.transaction(async (tx) => {
      // Row lock first: two re-classification passes over the same answer
      // (overlapping jobs) otherwise both delete-then-insert and double its
      // citations and mentions. The second waits and rewrites cleanly.
      await tx.execute(sql`select id from aiv_observations where id = ${o.observationId}::uuid for update`);
      // A re-read that changes the reading keeps the previous one in the
      // answer's own history: nothing a parser once read is lost silently.
      let readingChanged = false;
      if (o.reparsed) {
        const cur = rowsOf(await tx.execute(sql`select answer_text, citation_support,
          coalesce((select jsonb_agg(c.url order by c.position) from aiv_citations c where c.observation_id = ${o.observationId}::uuid), '[]'::jsonb) as urls
          from aiv_observations where id = ${o.observationId}::uuid`))[0];
        const prevUrls: string[] = Array.isArray(cur?.urls) ? cur.urls : [];
        const nextUrls = o.citations.map((c) => c.url);
        readingChanged = !!cur && (cur.answer_text !== o.reparsed.answerText || cur.citation_support !== o.reparsed.citationSupport
          || prevUrls.length !== nextUrls.length || prevUrls.some((u, i) => u !== nextUrls[i]));
        if (readingChanged) {
          await tx.execute(sql`update aiv_observations set raw_metadata = jsonb_set(raw_metadata, '{readingHistory}',
            coalesce(raw_metadata -> 'readingHistory', '[]'::jsonb) || ${pgJsonb([{ replacedAt: new Date().toISOString(), answerText: cur.answer_text, citationSupport: cur.citation_support, citationUrls: prevUrls }])})
            where id = ${o.observationId}::uuid`);
        }
      }
      await tx.execute(sql`delete from aiv_citations where observation_id = ${o.observationId}::uuid`);
      await tx.execute(sql`delete from aiv_mentions where observation_id = ${o.observationId}::uuid`);
      for (const c of o.citations) {
        await tx.execute(sql`insert into aiv_citations (observation_id, project_id, position, url, title, host, page_key, role, competitor_id, source_kind)
          values (${o.observationId}::uuid, ${o.projectId}::uuid, ${c.position}, ${c.url.slice(0, 2000)}, ${c.title ? c.title.slice(0, 500) : null}, ${c.host}, ${c.pageKey.slice(0, 2000)}, ${c.role},
            ${c.competitorId ? sql`${c.competitorId}::uuid` : sql`null`}, ${c.sourceKind})`);
      }
      const ments = [
        ...(o.brandMention ? [{ kind: 'BRAND', cid: null as string | null, m: o.brandMention }] : []),
        ...o.competitorMentions.map((m) => ({ kind: 'COMPETITOR', cid: m.entityId, m })),
      ];
      for (const x of ments) {
        await tx.execute(sql`insert into aiv_mentions (observation_id, project_id, entity_kind, competitor_id, matched_text, first_index, occurrences)
          values (${o.observationId}::uuid, ${o.projectId}::uuid, ${x.kind}, ${x.cid && UUID.test(x.cid) ? sql`${x.cid}::uuid` : sql`null`}, ${x.m.matchedText.slice(0, 200)}, ${x.m.firstIndex}, ${x.m.occurrences})`);
      }
      await tx.execute(sql`update aiv_observations set brand_mentioned = ${o.brandMentioned}, own_cited = ${o.ownCited}, citation_count = ${o.citations.length}
        ${o.reparsed ? sql`, answer_text = ${o.reparsed.answerText}, citation_support = ${o.reparsed.citationSupport}` : sql``}
        where id = ${o.observationId}::uuid`);
      return { readingChanged };
    });
  }
  async findRunByIdempotencyKey(projectId: string, key: string) {
    const r = rowsOf(await db.execute(sql`select * from aiv_runs where project_id = ${projectId}::uuid and idempotency_key = ${key}`))[0];
    return r ? run(r) : null;
  }
  async findActiveRun(projectId: string, kind: AivRun['kind']) {
    // One active run per project, whatever its kind: two runs spending at once
    // could each pass the per-call spend check and jointly exceed a limit.
    void kind;
    const r = rowsOf(await db.execute(sql`select * from aiv_runs where project_id = ${projectId}::uuid and status in ('AWAITING_APPROVAL','QUEUED','RUNNING') order by created_at desc limit 1`))[0];
    return r ? run(r) : null;
  }
  async createRun(i: Parameters<AiVisibilityRepository['createRun']>[0]) {
    const r = rowsOf(await db.execute(sql`
      insert into aiv_runs (project_id, kind, status, idempotency_key, providers, query_ids, adhoc_queries, total_tasks, estimated_usd, requested_by, actor_kind, action_id, over_threshold)
      values (${i.projectId}::uuid, ${i.kind}, ${i.status}, ${i.idempotencyKey}, ${pgJsonb(i.providers)}, ${pgJsonb(i.queryIds)}, ${pgJsonb(i.adhocQueries)}, ${i.totalTasks}, ${i.estimatedUsd},
        ${i.requestedBy && UUID.test(i.requestedBy) ? sql`${i.requestedBy}::uuid` : sql`null`}, ${i.actorKind}, ${i.actionId && UUID.test(i.actionId) ? sql`${i.actionId}::uuid` : sql`null`}, ${i.overThreshold})
      on conflict (project_id, idempotency_key) do nothing
      returning *`))[0];
    // Two identical requests in the same instant: the second gets the first's run, not a 500.
    if (!r) return (await this.findRunByIdempotencyKey(i.projectId, i.idempotencyKey)) as AivRun;
    return run(r);
  }
  async getRun(projectId: string, runId: string) {
    if (!UUID.test(runId)) return null;
    const r = rowsOf(await db.execute(sql`select * from aiv_runs where id = ${runId}::uuid and project_id = ${projectId}::uuid`))[0];
    return r ? run(r) : null;
  }
  async getRunById(runId: string) {
    if (!UUID.test(runId)) return null;
    const r = rowsOf(await db.execute(sql`select * from aiv_runs where id = ${runId}::uuid`))[0];
    return r ? run(r) : null;
  }
  async listRuns(projectId: string, limit: number, offset: number, kind?: AivRun['kind']) {
    const w = kind ? sql`project_id = ${projectId}::uuid and kind = ${kind}` : sql`project_id = ${projectId}::uuid`;
    const [rows, total] = await Promise.all([
      db.execute(sql`select * from aiv_runs where ${w} order by created_at desc limit ${lim(limit)} offset ${off(offset)}`),
      db.execute(sql`select count(*)::int as n from aiv_runs where ${w}`),
    ]);
    return page(rowsOf(rows).map(run), n(rowsOf(total)[0]?.n), lim(limit), off(offset));
  }
  async moveRun(runId: string, from: readonly string[], to: RunStatus, p: { approvedBy?: string; phase?: string; error?: string | null; started?: boolean; finished?: boolean } = {}) {
    const r = rowsOf(await db.execute(sql`
      update aiv_runs set status = ${to},
        phase = coalesce(${p.phase ?? null}, phase),
        error = ${p.error !== undefined ? sql`${p.error}` : sql`error`},
        approved_by = ${p.approvedBy && UUID.test(p.approvedBy) ? sql`${p.approvedBy}::uuid` : sql`approved_by`},
        approved_at = ${p.approvedBy ? sql`now()` : sql`approved_at`},
        started_at = ${p.started ? sql`now()` : sql`started_at`},
        heartbeat_at = ${p.started ? sql`now()` : sql`heartbeat_at`},
        finished_at = ${p.finished ? sql`now()` : sql`finished_at`}
      where id = ${runId}::uuid and status in (select jsonb_array_elements_text(${pgJsonb([...from])})) returning id`));
    return r.length > 0;
  }
  async updateRunProgress(runId: string, p: { succeeded: number; failed: number; skipped: number; actualUsd: number; phase: string }) {
    await db.execute(sql`update aiv_runs set succeeded = ${p.succeeded}, failed = ${p.failed}, skipped = ${p.skipped}, actual_usd = ${p.actualUsd}, phase = ${p.phase}, heartbeat_at = now() where id = ${runId}::uuid and status = 'RUNNING'`);
  }
  async requestCancel(runId: string) {
    const r = rowsOf(await db.execute(sql`update aiv_runs set cancel_requested = true where id = ${runId}::uuid and status = 'RUNNING' returning id`));
    return r.length > 0;
  }
  async failStaleRuns(minutes: number) {
    const r = rowsOf(await db.execute(sql`
      update aiv_runs set status = 'FAILED', finished_at = now(), phase = 'Failed',
        error = 'The worker stopped before the run finished (server restart or crash). Answers already recorded are kept.'
      -- Dead = no progress for this long (heartbeat), not "started long ago":
      -- a healthy run may take hours; one call takes at most ~5 minutes.
      where status = 'RUNNING' and coalesce(heartbeat_at, started_at, created_at) < now() - make_interval(mins => ${Math.max(5, Math.trunc(minutes))})
      returning id`));
    return r.map((x) => String(x.id));
  }
  async runStopReason(runId: string) {
    const r = rowsOf(await db.execute(sql`select cancel_requested, status from aiv_runs where id = ${runId}::uuid`))[0];
    if (!r || r.status !== 'RUNNING') return 'ENDED' as const;
    return r.cancel_requested ? ('CANCELLED' as const) : null;
  }
  async expireUnattendedRuns(approvalHours: number, queuedMinutes: number) {
    const r = rowsOf(await db.execute(sql`
      update aiv_runs set status = case when status = 'AWAITING_APPROVAL' then 'REJECTED' else 'FAILED' end,
        finished_at = now(), phase = 'Closed',
        error = case when status = 'AWAITING_APPROVAL' then 'Nobody approved this run within ' || ${Math.trunc(approvalHours)}::int || ' hours.'
                     else 'The run was queued but never started (the background queue lost it).' end
      where (status = 'AWAITING_APPROVAL' and created_at < now() - make_interval(hours => ${Math.max(1, Math.trunc(approvalHours))}))
         or (status = 'QUEUED' and coalesce(approved_at, created_at) < now() - make_interval(mins => ${Math.max(10, Math.trunc(queuedMinutes))}))
      returning id, project_id, (case when phase = 'Closed' and error like 'Nobody%' then 'AWAITING_APPROVAL' else 'QUEUED' end) as from_status`));
    return r.map((x) => ({ id: String(x.id), projectId: String(x.project_id), from: String(x.from_status) }));
  }
  async isCancelRequested(runId: string) {
    // "Stop" also when the run is no longer RUNNING (e.g. marked FAILED as
    // stale): a worker must never keep spending for a run the database has ended.
    const r = rowsOf(await db.execute(sql`select cancel_requested, status from aiv_runs where id = ${runId}::uuid`))[0];
    return !r || !!r.cancel_requested || r.status !== 'RUNNING';
  }

  async insertObservation(o: NewObservation) {
    return db.transaction(async (tx) => {
      const a = o.answer;
      const r = rowsOf(await tx.execute(sql`
        insert into aiv_observations (run_id, project_id, run_kind, query_id, query_text, provider, model, status, error_code, error_message, answer_text,
          citation_support, brand_mentioned, own_cited, citation_count, requested_location, applied_location, latency_ms, input_tokens, output_tokens, search_calls, cost_usd, raw_metadata)
        values (${o.runId}::uuid, ${o.projectId}::uuid, ${o.runKind}, ${o.queryId && UUID.test(o.queryId) ? sql`${o.queryId}::uuid` : sql`null`}, ${o.queryText}, ${o.provider}, ${a?.model ?? null},
          ${o.status}, ${o.errorCode}, ${o.errorMessage}, ${a?.answerText ?? null}, ${a?.citationSupport ?? null}, ${o.brandMentioned}, ${o.ownCited}, ${o.citations.length},
          ${o.requestedLocation}, ${a?.appliedLocation ?? null}, ${a?.latencyMs ?? null}, ${a?.usage.inputTokens ?? null}, ${a?.usage.outputTokens ?? null}, ${a?.usage.searchCalls ?? null},
          ${a?.costUsd ?? o.costUsd ?? null}, ${pgJsonb(a?.rawMetadata ?? (o.costUsd != null ? { costBasis: 'ESTIMATE_PER_CALL', possiblyBilled: true } : {}))})
        on conflict (run_id, query_text, provider) do nothing returning id`))[0];
      if (!r) {
        const e = rowsOf(await tx.execute(sql`select id from aiv_observations where run_id = ${o.runId}::uuid and query_text = ${o.queryText} and provider = ${o.provider}`))[0];
        return { id: String(e?.id ?? ''), inserted: false };
      }
      for (const c of o.citations) {
        await tx.execute(sql`insert into aiv_citations (observation_id, project_id, position, url, title, host, page_key, role, competitor_id, source_kind)
          values (${r.id}::uuid, ${o.projectId}::uuid, ${c.position}, ${c.url.slice(0, 2000)}, ${c.title ? c.title.slice(0, 500) : null}, ${c.host}, ${c.pageKey.slice(0, 2000)}, ${c.role},
            ${c.competitorId ? sql`${c.competitorId}::uuid` : sql`null`}, ${c.sourceKind})`);
      }
      const ments = [
        ...(o.brandMention ? [{ kind: 'BRAND', cid: null as string | null, m: o.brandMention }] : []),
        ...o.competitorMentions.map((m) => ({ kind: 'COMPETITOR', cid: m.entityId, m })),
      ];
      for (const x of ments) {
        await tx.execute(sql`insert into aiv_mentions (observation_id, project_id, entity_kind, competitor_id, matched_text, first_index, occurrences)
          values (${r.id}::uuid, ${o.projectId}::uuid, ${x.kind}, ${x.cid && UUID.test(x.cid) ? sql`${x.cid}::uuid` : sql`null`}, ${x.m.matchedText.slice(0, 200)}, ${x.m.firstIndex}, ${x.m.occurrences})`);
      }
      return { id: String(r.id), inserted: true };
    });
  }

  async listObservations(projectId: string, f: ObservationFilter) {
    const w: SQL[] = [sql`project_id = ${projectId}::uuid`];
    if (f.runId && UUID.test(f.runId)) w.push(sql`run_id = ${f.runId}::uuid`);
    if (f.queryId && UUID.test(f.queryId)) w.push(sql`query_id = ${f.queryId}::uuid`);
    if (f.provider) w.push(sql`provider = ${f.provider}`);
    if (f.runKind) w.push(sql`run_kind = ${f.runKind}`);
    if (f.status) w.push(sql`status = ${f.status}`);
    if (f.mentioned !== undefined) w.push(sql`brand_mentioned = ${f.mentioned}`);
    if (f.cited !== undefined) w.push(sql`own_cited = ${f.cited}`);
    if (f.fromIso) w.push(sql`executed_at >= ${f.fromIso}::timestamptz`);
    if (f.toIso) w.push(sql`executed_at < ${f.toIso}::timestamptz`);
    const where = sql.join(w, sql` and `);
    // The list never loads answer bodies; the detail endpoint does.
    const cols = sql`id, run_id, run_kind, query_id, query_text, provider, model, status, error_code, error_message, citation_support, brand_mentioned, own_cited, citation_count, cost_usd, latency_ms, requested_location, applied_location, executed_at`;
    const [rows, total] = await Promise.all([
      db.execute(sql`select ${cols} from aiv_observations where ${where} order by executed_at desc limit ${lim(f.limit)} offset ${off(f.offset)}`),
      db.execute(sql`select count(*)::int as n from aiv_observations where ${where}`),
    ]);
    return page(rowsOf(rows).map(obs), n(rowsOf(total)[0]?.n), lim(f.limit), off(f.offset));
  }
  async getObservation(projectId: string, id: string) {
    if (!UUID.test(id)) return null;
    const r = rowsOf(await db.execute(sql`select * from aiv_observations where id = ${id}::uuid and project_id = ${projectId}::uuid`))[0];
    return r ? { ...obs(r), answerText: r.answer_text, rawMetadata: r.raw_metadata ?? {} } : null;
  }
  async citationsFor(ids: readonly string[]): Promise<AivCitationRow[]> {
    if (ids.length === 0) return [];
    return rowsOf(await db.execute(sql`select * from aiv_citations where observation_id = any(${pgUuidArray(ids)}) order by observation_id, position`)).map((r) => ({
      observationId: r.observation_id, position: nn(r.position), url: r.url, title: r.title, host: r.host, pageKey: r.page_key, role: r.role, competitorId: r.competitor_id, sourceKind: r.source_kind,
    }));
  }
  async mentionsFor(ids: readonly string[]): Promise<AivMentionRow[]> {
    if (ids.length === 0) return [];
    return rowsOf(await db.execute(sql`select * from aiv_mentions where observation_id = any(${pgUuidArray(ids)})`)).map((r) => ({
      observationId: r.observation_id, entityKind: r.entity_kind, competitorId: r.competitor_id, matchedText: r.matched_text, firstIndex: n(r.first_index), occurrences: n(r.occurrences),
    }));
  }
  async latestPairs(projectId: string, sinceIso: string | null) {
    const rows = rowsOf(await db.execute(sql`
      select * from (
        select o.*, row_number() over (partition by o.query_id, o.provider order by o.executed_at desc) as rn
        from aiv_observations o
        -- Current state = questions still tracked AND active. A paused or deleted
        -- question's last answer must not keep moving the figures and gaps.
        join aiv_queries q on q.id = o.query_id and q.active
        where o.project_id = ${projectId}::uuid and o.run_kind <> 'RESEARCH' and o.status = 'SUCCEEDED'
          ${sinceIso ? sql`and o.executed_at >= ${sinceIso}::timestamptz` : sql``}
      ) t where rn <= 2 order by query_text, provider, rn`));
    const map = new Map<string, { queryId: string | null; queryText: string; provider: ProviderId; current: AivObservationRow; previous: AivObservationRow | null }>();
    for (const r of rows) {
      const k = `${r.query_id ?? r.query_text}|${r.provider}`;
      if (n(r.rn) === 1) map.set(k, { queryId: r.query_id, queryText: r.query_text, provider: r.provider, current: obs(r), previous: null });
      else { const e = map.get(k); if (e) e.previous = obs(r); }
    }
    return [...map.values()];
  }
  async dailySeries(projectId: string, fromIso: string, toIso: string) {
    return rowsOf(await db.execute(sql`
      select to_char(date_trunc('day', executed_at), 'YYYY-MM-DD') as day, provider,
        count(*)::int as answered,
        count(*) filter (where brand_mentioned)::int as mentioned,
        count(*) filter (where own_cited is not null)::int as eligible,
        count(*) filter (where own_cited)::int as cited
      from aiv_observations
      where project_id = ${projectId}::uuid and run_kind <> 'RESEARCH' and status = 'SUCCEEDED'
        and executed_at >= ${fromIso}::timestamptz and executed_at < ${toIso}::timestamptz
      group by 1, 2 order by 1, 2`)).map((r) => ({ day: r.day, provider: r.provider, answered: n(r.answered), mentioned: n(r.mentioned), eligible: n(r.eligible), cited: n(r.cited) }));
  }

  async createAction(a: Parameters<AiVisibilityRepository['createAction']>[0]) {
    return db.transaction(async (tx) => {
      const r = rowsOf(await tx.execute(sql`
        insert into aiv_actions (project_id, category, risk, status, title, reason, mechanism, plan, target_page, expected_impact, limitations, confidence, evidence, query_ids, baseline, rollback, proposed_by, proposer_kind, verify_after)
        values (${a.projectId}::uuid, ${a.category}, ${a.risk}, ${a.status}, ${a.title}, ${a.reason}, ${a.mechanism}, ${a.plan}, ${a.targetPage}, ${a.expectedImpact}, ${a.limitations}, ${a.confidence},
          ${pgJsonb(a.evidence)}, ${pgJsonb(a.queryIds)}, ${a.baseline ? pgJsonb(a.baseline) : sql`null`}, ${a.rollback},
          ${a.proposedBy && UUID.test(a.proposedBy) ? sql`${a.proposedBy}::uuid` : sql`null`}, ${a.proposerKind}, null)
        returning *`))[0];
      await tx.execute(sql`insert into aiv_action_events (action_id, from_status, to_status, actor_id, actor_kind, note)
        values (${r.id}::uuid, null, ${a.status}, ${a.proposedBy && UUID.test(a.proposedBy) ? sql`${a.proposedBy}::uuid` : sql`null`}, ${a.proposerKind}, 'Proposed')`);
      return action(r);
    });
  }
  async getAction(projectId: string, id: string) {
    if (!UUID.test(id)) return null;
    const r = rowsOf(await db.execute(sql`select * from aiv_actions where id = ${id}::uuid and project_id = ${projectId}::uuid`))[0];
    return r ? action(r) : null;
  }
  async listActions(projectId: string, status: string | null, limit: number, offset: number) {
    const w = status ? sql`project_id = ${projectId}::uuid and status = ${status}` : sql`project_id = ${projectId}::uuid`;
    const [rows, total] = await Promise.all([
      db.execute(sql`select * from aiv_actions where ${w} order by updated_at desc limit ${lim(limit)} offset ${off(offset)}`),
      db.execute(sql`select count(*)::int as n from aiv_actions where ${w}`),
    ]);
    return page(rowsOf(rows).map(action), n(rowsOf(total)[0]?.n), lim(limit), off(offset));
  }
  async moveAction(id: string, from: ActionStatus, to: ActionStatus, actor: { id: string | null; kind: ActorKind }, note: string | null, p: Parameters<AiVisibilityRepository['moveAction']>[5] = {}) {
    return db.transaction(async (tx) => {
      const uid = (v?: string | null) => (v && UUID.test(v) ? sql`${v}::uuid` : null);
      const r = rowsOf(await tx.execute(sql`
        update aiv_actions set status = ${to}, updated_at = now(),
          approved_by = coalesce(${uid(p?.approvedBy)}, approved_by),
          approved_at = coalesce(${p?.approvedAt ?? null}::timestamptz, approved_at),
          executed_by = coalesce(${uid(p?.executedBy)}, executed_by),
          executed_at = coalesce(${p?.executedAt ?? null}::timestamptz, executed_at),
          result = coalesce(${p?.result ?? null}, result),
          rollback = coalesce(${p?.rollback ?? null}, rollback),
          verification = coalesce(${p?.verification ? pgJsonb(p.verification) : null}, verification),
          baseline = coalesce(${p?.baseline ? pgJsonb(p.baseline) : null}, baseline),
          verify_after = coalesce(${p?.verifyAfter ?? null}::timestamptz, verify_after)
        where id = ${id}::uuid and status = ${from} returning id`));
      if (r.length === 0) return false;
      await tx.execute(sql`insert into aiv_action_events (action_id, from_status, to_status, actor_id, actor_kind, note)
        values (${id}::uuid, ${from}, ${to}, ${uid(actor.id) ?? sql`null`}, ${actor.kind}, ${note})`);
      return true;
    });
  }
  async listActionEvents(actionId: string) {
    return rowsOf(await db.execute(sql`select * from aiv_action_events where action_id = ${actionId}::uuid order by created_at`)).map((r) => ({
      fromStatus: r.from_status, toStatus: r.to_status, actorId: r.actor_id, actorKind: r.actor_kind, note: r.note, createdAt: iso(r.created_at) as string,
    }));
  }
}
