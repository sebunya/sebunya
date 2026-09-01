import { sql } from 'drizzle-orm';
import { db } from '../client';
import { pgJsonb } from '../PgParams';
import { displayImageUrlSql } from '../mediaDisplayUrl';

/**
 * Organic Growth OS data access (migration 0116). Raw-SQL via db.execute with
 * the rowsOf guard (postgres-js may return row arrays directly), matching the
 * house style of DrizzleHeroRepository. jsonb binding rules: objects bind
 * `${pgJsonb(obj)}`, arrays bind `${JSON.stringify(arr)}::text::jsonb`.
 *
 * Evidence discipline: nothing here invents data. marketShare() returns zeros
 * with observedQueries=0 (and says so in the methodology string) when there
 * are no SERP observations yet.
 */

const rowsOf = (result: unknown): any[] => (Array.isArray(result) ? result : (result as any)?.rows ?? []);

const OUR_DOMAIN = 'shopgoldplus.com';

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const dateOrNull = (v: unknown): Date | null => (v ? new Date(v as string) : null);

export interface SeoCompetitorInput {
  canonicalName: string;
  aliases?: string[];
  domains?: string[];
  businessType?: string;
  country?: string | null;
  ugandaRelevance?: string;
  localPresence?: boolean | null;
  productOverlap?: string[];
  categoryOverlap?: string[];
  b2bRelevant?: boolean | null;
  isMarketplace?: boolean;
  isBrand?: boolean;
  directness?: string;
  status?: string;
  mergedIntoId?: string | null;
  evidenceSource?: string | null;
  evidenceState?: string;
  lastVerifiedAt?: Date | null;
}

export interface SeoQueryInput {
  query: string;
  normalizedQuery: string;
  intent?: string;
  funnelStage?: string | null;
  category?: string | null;
  subcategory?: string | null;
  productType?: string | null;
  brand?: string | null;
  model?: string | null;
  flags?: Record<string, boolean>;
  targetPath?: string | null;
  country?: string;
  city?: string | null;
  device?: string;
  language?: string;
  source: string;
  volume?: number | null;
  volumeSource?: string | null;
  cpcUsd?: number | null;
  difficulty?: number | null;
  difficultyMethodology?: string | null;
  priority?: string;
  commercialValue?: string;
  readiness?: string;
  evidenceState?: string;
  lastObservedAt?: Date | null;
}

export interface SerpObservationInput {
  queryId: string;
  engine?: string;
  provider: string;
  country?: string;
  city?: string | null;
  device?: string;
  language?: string;
  observedAt: Date;
  rank?: number | null;
  url?: string | null;
  domain?: string | null;
  title?: string | null;
  resultType?: string;
  serpFeatures?: string[];
  competitorId?: string | null;
  rawProviderId?: string | null;
  evidenceRef?: string | null;
}

export interface SeoOpportunityInput {
  id?: string;
  kind: string;
  title: string;
  detail: string;
  queryId?: string | null;
  url?: string | null;
  opportunityValue?: string;
  evidenceConfidence?: string;
  commercialReadiness?: string;
  technicalReadiness?: string;
  effort?: string;
  risk?: string;
  status?: string;
  source: string;
  evidence?: Record<string, unknown> | null;
}

export interface SeoGapRecordInput {
  id?: string;
  queryId: string;
  ourPosition?: number | null;
  ourUrl?: string | null;
  leaderCompetitorId?: string | null;
  leaderPosition?: number | null;
  leaderUrl?: string | null;
  leaderPageType?: string | null;
  observedGaps?: string[];
  confidence?: string;
  action?: string | null;
  owner?: string | null;
  experimentId?: string | null;
  result?: string | null;
  status?: string;
}

export interface SeoChangeLedgerInput {
  actorId?: string | null;
  occurredAt?: Date;
  scope: string;
  target: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  reason: string;
  experimentId?: string | null;
  deploymentRef?: string | null;
  validationState?: string;
}

export interface SeoCrawlPageInput {
  url: string;
  finalUrl: string;
  httpStatus: number;
  redirectChain?: string[];
  contentType?: string | null;
  canonical?: string | null;
  metaRobots?: string | null;
  title?: string | null;
  metaDescription?: string | null;
  h1?: string | null;
  headings?: Record<string, unknown> | null;
  wordCount?: number | null;
  imagesMissingAlt?: number | null;
  internalLinks?: string[] | null;
  structuredDataTypes?: string[] | null;
  issues?: string[] | null;
  responseMs?: number | null;
  contentHash?: string | null;
  crawledAt?: Date;
}

export interface LinkGraphLink { toPath: string; anchor?: string | null; rel?: string | null }

export interface MarketShareResult {
  windowDays: number;
  observedQueries: number;
  top1: { count: number; share: number };
  top3: { count: number; share: number };
  top5: { count: number; share: number };
  top10: { count: number; share: number };
  top20: { count: number; share: number };
  outrank: { queriesWithCompetitorPresence: number; outrankedCount: number; rate: number };
  methodology: string;
}

export class DrizzleSeoGrowthRepository {
  // ── Competitors ──────────────────────────────────────────────────────────

  async listCompetitors(filter?: { status?: string; directness?: string; businessType?: string; search?: string }): Promise<any[]> {
    const where: ReturnType<typeof sql>[] = [sql`true`];
    if (filter?.status) where.push(sql`status = ${filter.status}`);
    if (filter?.directness) where.push(sql`directness = ${filter.directness}`);
    if (filter?.businessType) where.push(sql`business_type = ${filter.businessType}`);
    if (filter?.search) where.push(sql`(canonical_name ilike ${'%' + filter.search + '%'} or aliases::text ilike ${'%' + filter.search + '%'})`);
    return rowsOf(await db.execute(sql`
      select * from seo_competitors where ${sql.join(where, sql` and `)}
      order by canonical_name asc
    `));
  }

  async upsertCompetitor(input: SeoCompetitorInput): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_competitors (
        canonical_name, aliases, domains, business_type, country, uganda_relevance,
        local_presence, product_overlap, category_overlap, b2b_relevant,
        is_marketplace, is_brand, directness, status, merged_into_id,
        evidence_source, evidence_state, last_verified_at
      ) values (
        ${input.canonicalName},
        ${JSON.stringify(input.aliases ?? [])}::text::jsonb,
        ${JSON.stringify(input.domains ?? [])}::text::jsonb,
        ${input.businessType ?? 'UNRESOLVED'},
        ${input.country ?? null},
        ${input.ugandaRelevance ?? 'UNKNOWN'},
        ${input.localPresence ?? null},
        ${JSON.stringify(input.productOverlap ?? [])}::text::jsonb,
        ${JSON.stringify(input.categoryOverlap ?? [])}::text::jsonb,
        ${input.b2bRelevant ?? null},
        ${input.isMarketplace ?? false},
        ${input.isBrand ?? false},
        ${input.directness ?? 'UNRESOLVED'},
        ${input.status ?? 'ACTIVE'},
        ${input.mergedIntoId ?? null},
        ${input.evidenceSource ?? null},
        ${input.evidenceState ?? 'UNKNOWN'},
        ${input.lastVerifiedAt ?? null}
      )
      on conflict (canonical_name) do update set
        aliases = excluded.aliases,
        domains = excluded.domains,
        business_type = excluded.business_type,
        country = excluded.country,
        uganda_relevance = excluded.uganda_relevance,
        local_presence = excluded.local_presence,
        product_overlap = excluded.product_overlap,
        category_overlap = excluded.category_overlap,
        b2b_relevant = excluded.b2b_relevant,
        is_marketplace = excluded.is_marketplace,
        is_brand = excluded.is_brand,
        directness = excluded.directness,
        status = excluded.status,
        merged_into_id = excluded.merged_into_id,
        evidence_source = excluded.evidence_source,
        evidence_state = excluded.evidence_state,
        last_verified_at = excluded.last_verified_at,
        updated_at = now()
      returning *
    `));
    return rows[0];
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  async listQueries(filter?: {
    priority?: string; intent?: string; category?: string; source?: string;
    search?: string; limit?: number; offset?: number;
  }): Promise<{ rows: any[]; total: number }> {
    const where: ReturnType<typeof sql>[] = [sql`true`];
    if (filter?.priority) where.push(sql`priority = ${filter.priority}`);
    if (filter?.intent) where.push(sql`intent = ${filter.intent}`);
    if (filter?.category) where.push(sql`category = ${filter.category}`);
    if (filter?.source) where.push(sql`source = ${filter.source}`);
    if (filter?.search) where.push(sql`normalized_query ilike ${'%' + filter.search + '%'}`);
    const cond = sql.join(where, sql` and `);
    const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 500);
    const offset = Math.max(filter?.offset ?? 0, 0);
    const totalRows = rowsOf(await db.execute(sql`select count(*)::int as n from seo_queries where ${cond}`));
    const rows = rowsOf(await db.execute(sql`
      select * from seo_queries where ${cond}
      order by priority asc, normalized_query asc
      limit ${limit} offset ${offset}
    `));
    return { rows, total: Number(totalRows[0]?.n ?? 0) };
  }

  async upsertQuery(input: SeoQueryInput): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_queries (
        query, normalized_query, intent, funnel_stage, category, subcategory,
        product_type, brand, model, flags, target_path, country, city, device,
        language, source, volume, volume_source, cpc_usd, difficulty,
        difficulty_methodology, priority, commercial_value, readiness,
        evidence_state, last_observed_at
      ) values (
        ${input.query}, ${input.normalizedQuery}, ${input.intent ?? 'UNKNOWN'},
        ${input.funnelStage ?? null}, ${input.category ?? null}, ${input.subcategory ?? null},
        ${input.productType ?? null}, ${input.brand ?? null}, ${input.model ?? null},
        ${(input.flags ?? {}) as never}::jsonb,
        ${input.targetPath ?? null}, ${input.country ?? 'UG'}, ${input.city ?? null},
        ${input.device ?? 'ALL'}, ${input.language ?? 'en'}, ${input.source},
        ${input.volume ?? null}, ${input.volumeSource ?? null}, ${input.cpcUsd ?? null},
        ${input.difficulty ?? null}, ${input.difficultyMethodology ?? null},
        ${input.priority ?? 'UNTRIAGED'}, ${input.commercialValue ?? 'UNKNOWN'},
        ${input.readiness ?? 'UNKNOWN'}, ${input.evidenceState ?? 'UNKNOWN'},
        ${input.lastObservedAt ?? null}
      )
      on conflict (normalized_query) do update set
        query = excluded.query,
        intent = excluded.intent,
        funnel_stage = excluded.funnel_stage,
        category = excluded.category,
        subcategory = excluded.subcategory,
        product_type = excluded.product_type,
        brand = excluded.brand,
        model = excluded.model,
        flags = excluded.flags,
        target_path = excluded.target_path,
        country = excluded.country,
        city = excluded.city,
        device = excluded.device,
        language = excluded.language,
        source = excluded.source,
        volume = coalesce(excluded.volume, seo_queries.volume),
        volume_source = coalesce(excluded.volume_source, seo_queries.volume_source),
        cpc_usd = coalesce(excluded.cpc_usd, seo_queries.cpc_usd),
        difficulty = coalesce(excluded.difficulty, seo_queries.difficulty),
        difficulty_methodology = coalesce(excluded.difficulty_methodology, seo_queries.difficulty_methodology),
        priority = excluded.priority,
        commercial_value = excluded.commercial_value,
        readiness = excluded.readiness,
        evidence_state = excluded.evidence_state,
        last_observed_at = greatest(coalesce(excluded.last_observed_at, seo_queries.last_observed_at), coalesce(seo_queries.last_observed_at, excluded.last_observed_at)),
        updated_at = now()
      returning *
    `));
    return rows[0];
  }

  // ── SERP observations + domain intelligence ──────────────────────────────

  /**
   * Inserts a batch of SERP observations, upserts occurrence counts into
   * seo_serp_domains, and promotes recurring unclassified domains
   * (>= 3 occurrences, classification UNREVIEWED, no competitor link) into
   * seo_competitors as CANDIDATE/UNRESOLVED rows with evidence_state OBSERVED.
   * Never touches domains already classified or already linked.
   */
  async recordSerpObservations(batch: SerpObservationInput[]): Promise<{ inserted: number; candidatesCreated: string[] }> {
    if (batch.length === 0) return { inserted: 0, candidatesCreated: [] };
    // One batch, one transaction. Written row by row, a provider timeout
    // mid-batch left observations counted whose occurrence counters and
    // competitor promotions had not been written, and the batch is not
    // replayable: a retry double-counts every row that did land.
    return db.transaction(async (tx) => {

      for (const o of batch) {
        await tx.execute(sql`
          insert into seo_serp_observations (
            query_id, engine, provider, country, city, device, language, observed_at,
            rank, url, domain, title, result_type, serp_features, competitor_id,
            raw_provider_id, evidence_ref
          ) values (
            ${o.queryId}, ${o.engine ?? 'GOOGLE'}, ${o.provider}, ${o.country ?? 'UG'},
            ${o.city ?? null}, ${o.device ?? 'MOBILE'}, ${o.language ?? 'en'}, ${o.observedAt},
            ${o.rank ?? null}, ${o.url ?? null}, ${o.domain ?? null}, ${o.title ?? null},
            ${o.resultType ?? 'ORGANIC'},
            ${JSON.stringify(o.serpFeatures ?? [])}::text::jsonb,
            ${o.competitorId ?? null}, ${o.rawProviderId ?? null}, ${o.evidenceRef ?? null}
          )
        `);
      }

      // Occurrence upsert (one round per distinct domain in the batch).
      const domainCounts = new Map<string, { count: number; lastSeen: Date }>();
      for (const o of batch) {
        const d = (o.domain ?? '').trim().toLowerCase();
        if (!d) continue;
        const cur = domainCounts.get(d);
        const seen = o.observedAt ?? new Date();
        if (cur) { cur.count += 1; if (seen > cur.lastSeen) cur.lastSeen = seen; }
        else domainCounts.set(d, { count: 1, lastSeen: seen });
      }
      for (const [domain, { count, lastSeen }] of domainCounts) {
        await tx.execute(sql`
          insert into seo_serp_domains (domain, occurrences, first_seen_at, last_seen_at)
          values (${domain}, ${count}, ${lastSeen}, ${lastSeen})
          on conflict (domain) do update set
            occurrences = seo_serp_domains.occurrences + ${count},
            last_seen_at = greatest(seo_serp_domains.last_seen_at, excluded.last_seen_at)
        `);
      }

      // Promote recurring unclassified domains to competitor CANDIDATEs.
      const candidatesCreated: string[] = [];
      const recurring = rowsOf(await tx.execute(sql`
        select id, domain from seo_serp_domains
        where occurrences >= 3 and classification = 'UNREVIEWED' and competitor_id is null
          and domain <> ${OUR_DOMAIN} and domain not like ${'%.' + OUR_DOMAIN}
      `));
      for (const row of recurring) {
        const domain = String(row.domain);
        const inserted = rowsOf(await tx.execute(sql`
          insert into seo_competitors (
            canonical_name, domains, business_type, uganda_relevance, directness,
            status, evidence_source, evidence_state
          ) values (
            ${domain}, ${JSON.stringify([domain])}::text::jsonb, 'UNRESOLVED', 'UNKNOWN',
            'UNRESOLVED', 'CANDIDATE', ${'SERP observation: domain seen >= 3 times'}, 'OBSERVED'
          )
          on conflict (canonical_name) do nothing
          returning id
        `));
        const competitorId = inserted[0]?.id
          ?? rowsOf(await tx.execute(sql`select id from seo_competitors where canonical_name = ${domain}`))[0]?.id;
        if (competitorId) {
          await tx.execute(sql`update seo_serp_domains set competitor_id = ${competitorId} where id = ${row.id}`);
          if (inserted[0]?.id) candidatesCreated.push(domain);
        }
      }

      return { inserted: batch.length, candidatesCreated };
    });
  }

  async listSerpObservations(queryId: string, paging?: { limit?: number }): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select * from seo_serp_observations where query_id = ${queryId}
      order by observed_at desc, rank asc nulls last
      limit ${Math.min(Math.max(paging?.limit ?? 200, 1), 1000)}
    `));
  }

  // ── Opportunities ────────────────────────────────────────────────────────

  async listOpportunities(filter?: { status?: string; kind?: string; limit?: number; offset?: number }): Promise<any[]> {
    const where: ReturnType<typeof sql>[] = [sql`true`];
    if (filter?.status) where.push(sql`status = ${filter.status}`);
    if (filter?.kind) where.push(sql`kind = ${filter.kind}`);
    const limit = Math.min(Math.max(filter?.limit ?? 200, 1), 500);
    const offset = Math.max(filter?.offset ?? 0, 0);
    return rowsOf(await db.execute(sql`
      select * from seo_opportunities where ${sql.join(where, sql` and `)}
      -- id breaks the tie: a generator run stamps a whole batch with the same
      -- created_at, and without a total order page 2 repeats or skips rows.
      order by created_at desc, id desc limit ${limit} offset ${offset}
    `));
  }

  async upsertOpportunity(input: SeoOpportunityInput): Promise<any> {
    if (input.id) {
      const rows = rowsOf(await db.execute(sql`
        update seo_opportunities set
          kind = ${input.kind}, title = ${input.title}, detail = ${input.detail},
          query_id = ${input.queryId ?? null}, url = ${input.url ?? null},
          opportunity_value = ${input.opportunityValue ?? 'UNKNOWN'},
          evidence_confidence = ${input.evidenceConfidence ?? 'LOW'},
          commercial_readiness = ${input.commercialReadiness ?? 'UNKNOWN'},
          technical_readiness = ${input.technicalReadiness ?? 'UNKNOWN'},
          effort = ${input.effort ?? 'M'}, risk = ${input.risk ?? 'LOW'},
          status = ${input.status ?? 'OPEN'}, source = ${input.source},
          evidence = ${input.evidence == null ? null : sql`${pgJsonb(input.evidence)}`},
          updated_at = now()
        where id = ${input.id}
        returning *
      `));
      return rows[0] ?? null;
    }
    const rows = rowsOf(await db.execute(sql`
      insert into seo_opportunities (
        kind, title, detail, query_id, url, opportunity_value, evidence_confidence,
        commercial_readiness, technical_readiness, effort, risk, status, source, evidence
      ) values (
        ${input.kind}, ${input.title}, ${input.detail}, ${input.queryId ?? null},
        ${input.url ?? null}, ${input.opportunityValue ?? 'UNKNOWN'},
        ${input.evidenceConfidence ?? 'LOW'}, ${input.commercialReadiness ?? 'UNKNOWN'},
        ${input.technicalReadiness ?? 'UNKNOWN'}, ${input.effort ?? 'M'},
        ${input.risk ?? 'LOW'}, ${input.status ?? 'OPEN'}, ${input.source},
        ${input.evidence == null ? null : sql`${pgJsonb(input.evidence)}`}
      ) returning *
    `));
    return rows[0];
  }

  async dismissOpportunity(id: string): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`
      update seo_opportunities set status = 'DISMISSED', updated_at = now()
      where id = ${id} returning id
    `));
    return rows.length > 0;
  }

  // ── Change ledger ────────────────────────────────────────────────────────

  async appendChangeLedger(entry: SeoChangeLedgerInput): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_change_ledger (
        actor_id, occurred_at, scope, target, old_value, new_value, reason,
        experiment_id, deployment_ref, validation_state
      ) values (
        ${entry.actorId ?? null}, ${entry.occurredAt ?? new Date()}, ${entry.scope},
        ${entry.target},
        ${entry.oldValue == null ? null : sql`${pgJsonb(entry.oldValue)}`},
        ${entry.newValue == null ? null : sql`${pgJsonb(entry.newValue)}`},
        ${entry.reason}, ${entry.experimentId ?? null}, ${entry.deploymentRef ?? null},
        ${entry.validationState ?? 'PENDING'}
      ) returning *
    `));
    return rows[0];
  }

  async listChangeLedger(filter?: { scope?: string; limit?: number; offset?: number }): Promise<any[]> {
    const where: ReturnType<typeof sql>[] = [sql`true`];
    if (filter?.scope) where.push(sql`scope = ${filter.scope}`);
    const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 500);
    const offset = Math.max(filter?.offset ?? 0, 0);
    return rowsOf(await db.execute(sql`
      select * from seo_change_ledger where ${sql.join(where, sql` and `)}
      order by occurred_at desc limit ${limit} offset ${offset}
    `));
  }

  // ── Integrations ─────────────────────────────────────────────────────────

  async listIntegrations(): Promise<any[]> {
    return rowsOf(await db.execute(sql`select * from seo_integrations order by provider asc`));
  }

  async upsertIntegrationStatus(provider: string, patch: {
    status?: string; config?: Record<string, unknown>;
    lastSuccessAt?: Date | null; lastFailureAt?: Date | null;
    lastError?: string | null; syncState?: Record<string, unknown> | null;
  }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_integrations (provider, status, config, last_success_at, last_failure_at, last_error, sync_state)
      values (
        ${provider}, ${patch.status ?? 'READY_FOR_CREDENTIALS'},
        ${(patch.config ?? {}) as never}::jsonb,
        ${patch.lastSuccessAt ?? null}, ${patch.lastFailureAt ?? null},
        ${patch.lastError ?? null},
        ${patch.syncState == null ? null : sql`${pgJsonb(patch.syncState)}`}
      )
      on conflict (provider) do update set
        status = coalesce(${patch.status ?? null}, seo_integrations.status),
        config = case when ${patch.config != null} then excluded.config else seo_integrations.config end,
        last_success_at = coalesce(excluded.last_success_at, seo_integrations.last_success_at),
        last_failure_at = coalesce(excluded.last_failure_at, seo_integrations.last_failure_at),
        last_error = ${patch.lastError !== undefined ? patch.lastError : null},
        sync_state = case when ${patch.syncState != null} then excluded.sync_state else seo_integrations.sync_state end,
        updated_at = now()
      returning *
    `));
    return rows[0];
  }

  async getIntegration(provider: string): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`select * from seo_integrations where provider = ${provider}`));
    return rows[0] ?? null;
  }

  /**
   * GSC warehouse upsert on the (date, page, query) unique index. Batched in
   * chunks of 500 rows per statement.
   */
  async upsertGscPerformance(rows: Array<{
    date: string; page: string; query: string;
    clicks: number; impressions: number; ctr: number | null; position: number | null;
  }>): Promise<number> {
    let written = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const values = sql.join(
        chunk.map((r) => sql`(${r.date}::date, ${r.page}, ${r.query}, ${r.clicks}, ${r.impressions}, ${r.ctr}, ${r.position})`),
        sql`, `,
      );
      await db.execute(sql`
        insert into gsc_performance (date, page, query, clicks, impressions, ctr, position)
        values ${values}
        on conflict (date, page, query) do update set
          clicks = excluded.clicks,
          impressions = excluded.impressions,
          ctr = excluded.ctr,
          position = excluded.position
      `);
      written += chunk.length;
    }
    return written;
  }

  /**
   * Every ACTIVE + APPROVED product with the fields the Merchant feed and the
   * feed-quality report need. Inclusion/diagnostics logic lives in the use case.
   */
  async feedProducts(): Promise<Array<{
    sku: string; slug: string; name: string; shortDescription: string;
    priceUgx: number; floorPriceUgx: number | null; stockStatus: string; imageUrl: string | null;
    modelNumber: string | null; isFeedEligible: boolean; active: boolean; approvalStatus: string;
  }>> {
    const rows = rowsOf(await db.execute(sql`
      select p.sku, p.slug, p.name, p.short_description, p.price_ugx, p.stock_status,
             coalesce(p.image_url, (select ${displayImageUrlSql('i')} from product_images i where i.product_id = p.id order by i.is_primary desc, i.display_order asc limit 1)) as image_url,
             p.model_number, p.is_feed_eligible, p.active, p.approval_status,
             pp.floor_price
      from products p
      left join product_prices pp on pp.product_id = p.id
      where p.active = true and p.approval_status = 'approved'
      order by p.sku asc
      limit 50000
    `));
    return rows.map((r: any) => ({
      sku: String(r.sku),
      slug: String(r.slug),
      name: String(r.name),
      shortDescription: String(r.short_description ?? ''),
      priceUgx: Number(r.price_ugx ?? 0),
      floorPriceUgx: r.floor_price == null ? null : Number(r.floor_price),
      stockStatus: String(r.stock_status ?? ''),
      imageUrl: r.image_url == null ? null : String(r.image_url),
      modelNumber: r.model_number == null ? null : String(r.model_number),
      isFeedEligible: Boolean(r.is_feed_eligible),
      active: Boolean(r.active),
      approvalStatus: String(r.approval_status ?? ''),
    }));
  }

  // ── Crawl runs & pages ───────────────────────────────────────────────────

  async createCrawlRun(input: { scope: string; pageLimit: number; notes?: string | null }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_crawl_runs (scope, page_limit, notes)
      values (${input.scope}, ${input.pageLimit}, ${input.notes ?? null})
      returning *
    `));
    return rows[0];
  }

  async getCrawlRun(runId: string): Promise<any | null> {
    const rows = rowsOf(await db.execute(sql`select * from seo_crawl_runs where id = ${runId}`));
    return rows[0] ?? null;
  }

  /**
   * Marks a RUNNING crawl CANCELLED without stamping finished_at — the worker
   * observes the status between pages, stops, and calls finishCrawlRun with the
   * real page count. Returns false when the run was not RUNNING.
   */
  async markCrawlRunCancelled(runId: string): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`
      update seo_crawl_runs set status = 'CANCELLED'
      where id = ${runId} and status = 'RUNNING' returning id
    `));
    return rows.length > 0;
  }

  async finishCrawlRun(runId: string, outcome: { status: 'COMPLETE' | 'FAILED' | 'CANCELLED'; pagesCrawled: number; notes?: string | null }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      update seo_crawl_runs set
        status = ${outcome.status}, finished_at = now(),
        pages_crawled = ${outcome.pagesCrawled},
        notes = coalesce(${outcome.notes ?? null}, notes)
      where id = ${runId} returning *
    `));
    return rows[0] ?? null;
  }

  async insertCrawlPages(runId: string, pages: SeoCrawlPageInput[]): Promise<number> {
    for (const p of pages) {
      await db.execute(sql`
        insert into seo_crawl_pages (
          run_id, url, final_url, http_status, redirect_chain, content_type,
          canonical, meta_robots, title, meta_description, h1, headings,
          word_count, images_missing_alt, internal_links, structured_data_types,
          issues, response_ms, content_hash, crawled_at
        ) values (
          ${runId}, ${p.url}, ${p.finalUrl}, ${p.httpStatus},
          ${JSON.stringify(p.redirectChain ?? [])}::text::jsonb,
          ${p.contentType ?? null}, ${p.canonical ?? null}, ${p.metaRobots ?? null},
          ${p.title ?? null}, ${p.metaDescription ?? null}, ${p.h1 ?? null},
          ${p.headings == null ? null : sql`${pgJsonb(p.headings)}`},
          ${p.wordCount ?? null}, ${p.imagesMissingAlt ?? null},
          ${p.internalLinks == null ? null : sql`${JSON.stringify(p.internalLinks)}::text::jsonb`},
          ${p.structuredDataTypes == null ? null : sql`${JSON.stringify(p.structuredDataTypes)}::text::jsonb`},
          ${p.issues == null ? null : sql`${JSON.stringify(p.issues)}::text::jsonb`},
          ${p.responseMs ?? null}, ${p.contentHash ?? null}, ${p.crawledAt ?? new Date()}
        )
      `);
    }
    return pages.length;
  }

  async listCrawlRuns(limit = 50): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select * from seo_crawl_runs order by started_at desc limit ${Math.min(Math.max(limit, 1), 200)}
    `));
  }

  async listCrawlPages(runId: string, paging?: { limit?: number; offset?: number }): Promise<{ rows: any[]; total: number }> {
    const limit = Math.min(Math.max(paging?.limit ?? 100, 1), 500);
    const offset = Math.max(paging?.offset ?? 0, 0);
    const totalRows = rowsOf(await db.execute(sql`select count(*)::int as n from seo_crawl_pages where run_id = ${runId}`));
    const rows = rowsOf(await db.execute(sql`
      select * from seo_crawl_pages where run_id = ${runId}
      order by url asc limit ${limit} offset ${offset}
    `));
    return { rows, total: Number(totalRows[0]?.n ?? 0) };
  }

  // ── Link graph ───────────────────────────────────────────────────────────

  async replaceLinkGraphForPath(fromPath: string, links: LinkGraphLink[]): Promise<number> {
    // Replace means replace: the delete and every insert are one transaction.
    // Autocommitted, a failure partway through left the page's link graph
    // emptied or half written, and the orphan report then invented orphans.
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from seo_link_graph where from_path = ${fromPath}`);
      for (const l of links) {
        await tx.execute(sql`
          insert into seo_link_graph (from_path, to_path, anchor, rel, last_seen_at)
          values (${fromPath}, ${l.toPath}, ${l.anchor ?? null}, ${l.rel ?? null}, now())
          on conflict (from_path, to_path, coalesce(anchor, '')) do update set
            rel = excluded.rel, last_seen_at = now()
        `);
      }
    });
    return links.length;
  }

  /**
   * Orphans = product/category paths present in the latest completed crawl but
   * with zero inbound edges in the link graph.
   */
  async linkGraphStats(): Promise<{ edges: number; distinctFromPaths: number; distinctToPaths: number; orphanPaths: string[] }> {
    const totals = rowsOf(await db.execute(sql`
      select count(*)::int as edges,
             count(distinct from_path)::int as from_paths,
             count(distinct to_path)::int as to_paths
      from seo_link_graph
    `));
    const orphans = rowsOf(await db.execute(sql`
      with latest_run as (
        select id from seo_crawl_runs where status = 'COMPLETE'
        order by started_at desc limit 1
      ),
      crawl_paths as (
        select distinct regexp_replace(final_url, '^https?://[^/]+', '') as path
        from seo_crawl_pages
        where run_id = (select id from latest_run) and http_status = 200
      )
      select cp.path from crawl_paths cp
      where (cp.path like '/products/%' or cp.path like '/categories/%' or cp.path like '/category/%')
        and not exists (select 1 from seo_link_graph lg where lg.to_path = cp.path)
      order by cp.path
    `));
    return {
      edges: Number(totals[0]?.edges ?? 0),
      distinctFromPaths: Number(totals[0]?.from_paths ?? 0),
      distinctToPaths: Number(totals[0]?.to_paths ?? 0),
      orphanPaths: orphans.map((r) => String(r.path)),
    };
  }

  // ── Alerts ───────────────────────────────────────────────────────────────

  async listAlerts(filter?: { status?: string; severity?: string; limit?: number }): Promise<any[]> {
    const where: ReturnType<typeof sql>[] = [sql`true`];
    if (filter?.status) where.push(sql`status = ${filter.status}`);
    if (filter?.severity) where.push(sql`severity = ${filter.severity}`);
    return rowsOf(await db.execute(sql`
      select * from seo_alerts where ${sql.join(where, sql` and `)}
      order by last_seen_at desc limit ${Math.min(Math.max(filter?.limit ?? 100, 1), 500)}
    `));
  }

  /** Dedupes on dedupe_key while an alert is OPEN (partial unique index). */
  async raiseAlert(input: { severity: string; kind: string; message: string; dedupeKey: string }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_alerts (severity, kind, message, dedupe_key)
      values (${input.severity}, ${input.kind}, ${input.message}, ${input.dedupeKey})
      on conflict (dedupe_key) where status = 'OPEN' do update set
        message = excluded.message,
        severity = excluded.severity,
        last_seen_at = now()
      returning *
    `));
    return rows[0];
  }

  async resolveAlert(id: string): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`
      update seo_alerts set status = 'RESOLVED', resolved_at = now()
      where id = ${id} and status <> 'RESOLVED' returning id
    `));
    return rows.length > 0;
  }

  // ── AEO ──────────────────────────────────────────────────────────────────

  async listAeoPrompts(filter?: { engine?: string; status?: string }): Promise<any[]> {
    const where: ReturnType<typeof sql>[] = [sql`true`];
    if (filter?.engine) where.push(sql`engine = ${filter.engine}`);
    if (filter?.status) where.push(sql`status = ${filter.status}`);
    return rowsOf(await db.execute(sql`
      select * from seo_aeo_prompts where ${sql.join(where, sql` and `)} order by created_at asc
    `));
  }

  async recordAeoObservation(input: {
    promptId: string; engine: string; modelVersion?: string | null; executedAt?: Date;
    responseExcerpt?: string | null; weMentioned: boolean; weCited: boolean;
    citationUrl?: string | null; competitorsMentioned?: string[]; competitorsCited?: string[];
    evidenceRef?: string | null;
  }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_aeo_observations (
        prompt_id, engine, model_version, executed_at, response_excerpt,
        we_mentioned, we_cited, citation_url, competitors_mentioned,
        competitors_cited, evidence_ref
      ) values (
        ${input.promptId}, ${input.engine}, ${input.modelVersion ?? null},
        ${input.executedAt ?? new Date()}, ${input.responseExcerpt ?? null},
        ${input.weMentioned}, ${input.weCited}, ${input.citationUrl ?? null},
        ${JSON.stringify(input.competitorsMentioned ?? [])}::text::jsonb,
        ${JSON.stringify(input.competitorsCited ?? [])}::text::jsonb,
        ${input.evidenceRef ?? null}
      ) returning *
    `));
    await db.execute(sql`update seo_aeo_prompts set status = 'EXECUTED', updated_at = now() where id = ${input.promptId}`);
    return rows[0];
  }

  async createAeoPrompt(input: { prompt: string; engine: string; category?: string | null; intent?: string | null }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_aeo_prompts (prompt, engine, category, intent)
      values (${input.prompt}, ${input.engine}, ${input.category ?? null}, ${input.intent ?? null})
      returning *
    `));
    return rows[0];
  }

  async listAeoObservations(promptId?: string, limit = 200): Promise<any[]> {
    const cond = promptId ? sql`prompt_id = ${promptId}` : sql`true`;
    return rowsOf(await db.execute(sql`
      select * from seo_aeo_observations where ${cond}
      order by executed_at desc limit ${Math.min(Math.max(limit, 1), 500)}
    `));
  }

  /**
   * Mention/citation coverage per engine over EXECUTED observations only.
   * Engines with zero executed observations simply do not appear — honest
   * zeros, nothing extrapolated.
   */
  async aeoCoverage(): Promise<Array<{ engine: string; observations: number; mentioned: number; cited: number; mentionRate: number; citationRate: number }>> {
    const rows = rowsOf(await db.execute(sql`
      select o.engine,
             count(*)::int as observations,
             count(*) filter (where o.we_mentioned)::int as mentioned,
             count(*) filter (where o.we_cited)::int as cited
      from seo_aeo_observations o
      join seo_aeo_prompts p on p.id = o.prompt_id
      where p.status = 'EXECUTED'
      group by o.engine
      order by o.engine
    `));
    return rows.map((r) => {
      const observations = Number(r.observations ?? 0);
      const mentioned = Number(r.mentioned ?? 0);
      const cited = Number(r.cited ?? 0);
      return {
        engine: String(r.engine),
        observations,
        mentioned,
        cited,
        mentionRate: observations === 0 ? 0 : mentioned / observations,
        citationRate: observations === 0 ? 0 : cited / observations,
      };
    });
  }

  // ── Experiments ──────────────────────────────────────────────────────────

  async listExperiments(limit = 100): Promise<any[]> {
    return rowsOf(await db.execute(sql`
      select * from seo_experiments order by created_at desc limit ${Math.min(Math.max(limit, 1), 500)}
    `));
  }

  async createExperiment(input: {
    name: string; hypothesis: string; change: string; metric: string;
    cohort?: string | null; startAt?: Date | null; endAt?: Date | null;
    baseline?: Record<string, unknown> | null;
  }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_experiments (name, hypothesis, change, metric, cohort, start_at, end_at, baseline)
      values (
        ${input.name}, ${input.hypothesis}, ${input.change}, ${input.metric},
        ${input.cohort ?? null}, ${input.startAt ?? null}, ${input.endAt ?? null},
        ${input.baseline == null ? null : sql`${pgJsonb(input.baseline)}`}
      ) returning *
    `));
    return rows[0];
  }

  async acknowledgeAlert(id: string): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`
      update seo_alerts set status = 'ACKNOWLEDGED'
      where id = ${id} and status = 'OPEN' returning id
    `));
    return rows.length > 0;
  }

  /** Real COUNT(*)s for the overview card — no cached or invented numbers. */
  async overviewCounts(): Promise<{ openOpportunities: number; openAlerts: number; competitors: number; candidateCompetitors: number; trackedQueries: number }> {
    const rows = rowsOf(await db.execute(sql`
      select
        (select count(*)::int from seo_opportunities where status = 'OPEN') as open_opportunities,
        (select count(*)::int from seo_alerts where status = 'OPEN') as open_alerts,
        (select count(*)::int from seo_competitors where status = 'ACTIVE') as competitors,
        (select count(*)::int from seo_competitors where status = 'CANDIDATE') as candidate_competitors,
        (select count(*)::int from seo_queries) as tracked_queries
    `));
    const r = rows[0] ?? {};
    return {
      openOpportunities: Number(r.open_opportunities ?? 0),
      openAlerts: Number(r.open_alerts ?? 0),
      competitors: Number(r.competitors ?? 0),
      candidateCompetitors: Number(r.candidate_competitors ?? 0),
      trackedQueries: Number(r.tracked_queries ?? 0),
    };
  }

  // ── Gap records ──────────────────────────────────────────────────────────

  async listGapRecords(filter?: { status?: string; queryId?: string; limit?: number; offset?: number }): Promise<any[]> {
    const where: ReturnType<typeof sql>[] = [sql`true`];
    if (filter?.status) where.push(sql`status = ${filter.status}`);
    if (filter?.queryId) where.push(sql`query_id = ${filter.queryId}`);
    const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 500);
    const offset = Math.max(filter?.offset ?? 0, 0);
    return rowsOf(await db.execute(sql`
      select * from seo_gap_records where ${sql.join(where, sql` and `)}
      order by updated_at desc limit ${limit} offset ${offset}
    `));
  }

  async upsertGapRecord(input: SeoGapRecordInput): Promise<any> {
    if (input.id) {
      const rows = rowsOf(await db.execute(sql`
        update seo_gap_records set
          our_position = ${input.ourPosition ?? null}, our_url = ${input.ourUrl ?? null},
          leader_competitor_id = ${input.leaderCompetitorId ?? null},
          leader_position = ${input.leaderPosition ?? null},
          leader_url = ${input.leaderUrl ?? null},
          leader_page_type = ${input.leaderPageType ?? null},
          observed_gaps = ${JSON.stringify(input.observedGaps ?? [])}::text::jsonb,
          confidence = ${input.confidence ?? 'LOW'}, action = ${input.action ?? null},
          owner = ${input.owner ?? null}, experiment_id = ${input.experimentId ?? null},
          result = ${input.result ?? null}, status = ${input.status ?? 'OPEN'},
          updated_at = now()
        where id = ${input.id} returning *
      `));
      return rows[0] ?? null;
    }
    const rows = rowsOf(await db.execute(sql`
      insert into seo_gap_records (
        query_id, our_position, our_url, leader_competitor_id, leader_position,
        leader_url, leader_page_type, observed_gaps, confidence, action, owner,
        experiment_id, result, status
      ) values (
        ${input.queryId}, ${input.ourPosition ?? null}, ${input.ourUrl ?? null},
        ${input.leaderCompetitorId ?? null}, ${input.leaderPosition ?? null},
        ${input.leaderUrl ?? null}, ${input.leaderPageType ?? null},
        ${JSON.stringify(input.observedGaps ?? [])}::text::jsonb,
        ${input.confidence ?? 'LOW'}, ${input.action ?? null}, ${input.owner ?? null},
        ${input.experimentId ?? null}, ${input.result ?? null}, ${input.status ?? 'OPEN'}
      ) returning *
    `));
    return rows[0];
  }

  // ── Keyword imports ──────────────────────────────────────────────────────

  async recordKeywordImport(input: {
    provider: string; country: string; language: string;
    methodology?: string | null; rowCount: number; importedBy?: string | null;
  }): Promise<any> {
    const rows = rowsOf(await db.execute(sql`
      insert into seo_keyword_imports (provider, country, language, methodology, row_count, imported_by)
      values (${input.provider}, ${input.country}, ${input.language},
              ${input.methodology ?? null}, ${input.rowCount}, ${input.importedBy ?? null})
      returning *
    `));
    return rows[0];
  }

  // ── Opportunity-generator evidence reads ─────────────────────────────────

  /** Aggregated GSC rows in the window; empty when gsc_performance is empty. */
  async gscOpportunityRows(windowDays: number): Promise<Array<{ page: string; query: string; impressions: number; clicks: number; position: number | null }>> {
    const days = Math.min(Math.max(Math.floor(windowDays) || 28, 1), 365);
    const rows = rowsOf(await db.execute(sql`
      select page, query,
             sum(impressions)::int as impressions,
             sum(clicks)::int as clicks,
             case when sum(impressions) > 0
               then sum(coalesce(position, 0) * impressions) / nullif(sum(case when position is not null then impressions else 0 end), 0)
               else null end as position
      from gsc_performance
      where date >= (current_date - make_interval(days => ${days}))::date
      group by page, query
      having sum(impressions) > 0
    `));
    return rows.map((r) => ({
      page: String(r.page),
      query: String(r.query),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      position: r.position == null ? null : Number(r.position),
    }));
  }

  /** Approved+active products with the three audited content attributes. */
  async productAttributeGapRows(): Promise<Array<{ id: string; slug: string; name: string; imageUrl: string | null; shortDescription: string; specifications: Record<string, unknown> }>> {
    const rows = rowsOf(await db.execute(sql`
      select id, slug, name, image_url, short_description, specifications
      from products
      where active = true and approval_status = 'approved'
    `));
    return rows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      imageUrl: r.image_url == null ? null : String(r.image_url),
      shortDescription: String(r.short_description ?? ''),
      specifications: obj(r.specifications),
    }));
  }

  /** Issue-bearing pages of the latest COMPLETE crawl run. */
  async latestCrawlIssuePages(): Promise<Array<{ url: string; finalUrl: string; httpStatus: number; issues: string[] }>> {
    const rows = rowsOf(await db.execute(sql`
      with latest_run as (
        select id from seo_crawl_runs where status = 'COMPLETE'
        order by started_at desc limit 1
      )
      select url, final_url, http_status, issues from seo_crawl_pages
      where run_id = (select id from latest_run)
        and issues is not null and jsonb_array_length(issues) > 0
    `));
    return rows.map((r) => ({
      url: String(r.url),
      finalUrl: String(r.final_url),
      httpStatus: Number(r.http_status),
      issues: arr(r.issues),
    }));
  }

  // ── Market share ─────────────────────────────────────────────────────────

  /**
   * Share = fraction of tracked queries where shopgoldplus.com holds an ORGANIC
   * rank <= N in the LATEST observation snapshot per (query, device) within the
   * window. Outrank rate = among queries whose latest snapshot contains at
   * least one known competitor domain, the fraction where our best rank beats
   * the best competitor rank. Returns honest zeros when nothing is observed.
   */
  async marketShare(windowDays: number): Promise<MarketShareResult> {
    const days = Math.min(Math.max(Math.floor(windowDays) || 30, 1), 365);
    const rows = rowsOf(await db.execute(sql`
      with windowed as (
        select o.query_id, o.device, o.observed_at, o.rank, o.domain, o.competitor_id
        from seo_serp_observations o
        where o.result_type = 'ORGANIC'
          and o.observed_at >= now() - make_interval(days => ${days})
      ),
      latest as (
        select query_id, device, max(observed_at) as observed_at
        from windowed group by query_id, device
      ),
      snapshot as (
        select w.* from windowed w
        join latest l on l.query_id = w.query_id and l.device = w.device and l.observed_at = w.observed_at
      )
      select
        query_id, device,
        min(case when domain = ${OUR_DOMAIN} or domain like ${'%.' + OUR_DOMAIN} then rank end) as our_rank,
        min(case when competitor_id is not null then rank end) as best_competitor_rank
      from snapshot
      group by query_id, device
    `));

    const observedQueries = rows.length;
    const zero = { count: 0, share: 0 };
    if (observedQueries === 0) {
      return {
        windowDays: days, observedQueries: 0,
        top1: zero, top3: zero, top5: zero, top10: zero, top20: zero,
        outrank: { queriesWithCompetitorPresence: 0, outrankedCount: 0, rate: 0 },
        methodology: `No ORGANIC SERP observations in the last ${days} days — all shares are 0 with observedQueries=0; nothing is estimated.`,
      };
    }

    const countAt = (n: number) => rows.filter((r) => r.our_rank != null && Number(r.our_rank) <= n).length;
    const bucket = (n: number) => ({ count: countAt(n), share: countAt(n) / observedQueries });
    const withComp = rows.filter((r) => r.best_competitor_rank != null);
    const outranked = withComp.filter((r) => r.our_rank != null && Number(r.our_rank) < Number(r.best_competitor_rank)).length;

    return {
      windowDays: days,
      observedQueries,
      top1: bucket(1), top3: bucket(3), top5: bucket(5), top10: bucket(10), top20: bucket(20),
      outrank: {
        queriesWithCompetitorPresence: withComp.length,
        outrankedCount: outranked,
        rate: withComp.length === 0 ? 0 : outranked / withComp.length,
      },
      methodology: `Share = fraction of ${observedQueries} tracked (query, device) pairs where ${OUR_DOMAIN} holds ORGANIC rank <= N in the latest observation snapshot within ${days} days. Outrank rate = fraction of pairs containing a linked competitor domain where our best rank beats the best competitor rank. Observed data only; no extrapolation.`,
    };
  }
}

// Keep helper imports referenced (used by future row mappers / callers).
export const seoGrowthRowHelpers = { rowsOf, arr, obj, dateOrNull };
