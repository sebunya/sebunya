import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Organic Growth OS — SEO data layer (migration 0116).
 *
 * Evidence-first: every fact row carries an evidence/confidence state and
 * unknowns stay NULL/'UNKNOWN'. Nothing here fabricates rankings, volumes or
 * competitor facts. CHECK constraints live in the hand-written migration; the
 * definitions below mirror it for the query builder.
 */

export const seoCompetitors = pgTable('seo_competitors', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalName: text('canonical_name').notNull(),
  aliases: jsonb('aliases').notNull().default([]),
  domains: jsonb('domains').notNull().default([]),
  businessType: text('business_type').notNull().default('UNRESOLVED'),
  country: text('country'),
  ugandaRelevance: text('uganda_relevance').notNull().default('UNKNOWN'),
  localPresence: boolean('local_presence'),
  productOverlap: jsonb('product_overlap').notNull().default([]),
  categoryOverlap: jsonb('category_overlap').notNull().default([]),
  b2bRelevant: boolean('b2b_relevant'),
  isMarketplace: boolean('is_marketplace').notNull().default(false),
  isBrand: boolean('is_brand').notNull().default(false),
  directness: text('directness').notNull().default('UNRESOLVED'),
  status: text('status').notNull().default('ACTIVE'),
  mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => seoCompetitors.id),
  evidenceSource: text('evidence_source'),
  evidenceState: text('evidence_state').notNull().default('UNKNOWN'),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  canonicalNameIdx: uniqueIndex('seo_competitors_canonical_name_idx').on(t.canonicalName),
  statusIdx: index('seo_competitors_status_idx').on(t.status),
}));

export const seoQueries = pgTable('seo_queries', {
  id: uuid('id').primaryKey().defaultRandom(),
  query: text('query').notNull(),
  normalizedQuery: text('normalized_query').notNull(),
  intent: text('intent').notNull().default('UNKNOWN'),
  funnelStage: text('funnel_stage'),
  category: text('category'),
  subcategory: text('subcategory'),
  productType: text('product_type'),
  brand: text('brand'),
  model: text('model'),
  flags: jsonb('flags').notNull().default({}),
  targetPath: text('target_path'),
  country: text('country').notNull().default('UG'),
  city: text('city'),
  device: text('device').notNull().default('ALL'),
  language: text('language').notNull().default('en'),
  source: text('source').notNull(),
  volume: integer('volume'),
  volumeSource: text('volume_source'),
  cpcUsd: numeric('cpc_usd'),
  difficulty: numeric('difficulty'),
  difficultyMethodology: text('difficulty_methodology'),
  priority: text('priority').notNull().default('UNTRIAGED'),
  commercialValue: text('commercial_value').notNull().default('UNKNOWN'),
  readiness: text('readiness').notNull().default('UNKNOWN'),
  evidenceState: text('evidence_state').notNull().default('UNKNOWN'),
  lastObservedAt: timestamp('last_observed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  normalizedIdx: uniqueIndex('seo_queries_normalized_query_idx').on(t.normalizedQuery),
  priorityIdx: index('seo_queries_priority_idx').on(t.priority),
  categoryIdx: index('seo_queries_category_idx').on(t.category),
}));

export const seoSerpObservations = pgTable('seo_serp_observations', {
  id: uuid('id').primaryKey().defaultRandom(),
  queryId: uuid('query_id').notNull().references(() => seoQueries.id),
  engine: text('engine').notNull().default('GOOGLE'),
  provider: text('provider').notNull(),
  country: text('country').notNull().default('UG'),
  city: text('city'),
  device: text('device').notNull().default('MOBILE'),
  language: text('language').notNull().default('en'),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  rank: integer('rank'),
  url: text('url'),
  domain: text('domain'),
  title: text('title'),
  resultType: text('result_type').notNull().default('ORGANIC'),
  serpFeatures: jsonb('serp_features').notNull().default([]),
  competitorId: uuid('competitor_id').references(() => seoCompetitors.id),
  rawProviderId: text('raw_provider_id'),
  evidenceRef: text('evidence_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  queryObservedIdx: index('seo_serp_obs_query_observed_idx').on(t.queryId, t.observedAt),
  domainIdx: index('seo_serp_obs_domain_idx').on(t.domain),
}));

export const seoGapRecords = pgTable('seo_gap_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  queryId: uuid('query_id').notNull().references(() => seoQueries.id),
  ourPosition: integer('our_position'),
  ourUrl: text('our_url'),
  leaderCompetitorId: uuid('leader_competitor_id').references(() => seoCompetitors.id),
  leaderPosition: integer('leader_position'),
  leaderUrl: text('leader_url'),
  leaderPageType: text('leader_page_type'),
  observedGaps: jsonb('observed_gaps').notNull().default([]),
  confidence: text('confidence').notNull().default('LOW'),
  action: text('action'),
  owner: text('owner'),
  experimentId: uuid('experiment_id'),
  result: text('result'),
  status: text('status').notNull().default('OPEN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  queryIdx: index('seo_gap_records_query_idx').on(t.queryId),
  statusIdx: index('seo_gap_records_status_idx').on(t.status),
}));

export const seoOpportunities = pgTable('seo_opportunities', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  queryId: uuid('query_id').references(() => seoQueries.id),
  url: text('url'),
  opportunityValue: text('opportunity_value').notNull().default('UNKNOWN'),
  evidenceConfidence: text('evidence_confidence').notNull().default('LOW'),
  commercialReadiness: text('commercial_readiness').notNull().default('UNKNOWN'),
  technicalReadiness: text('technical_readiness').notNull().default('UNKNOWN'),
  effort: text('effort').notNull().default('M'),
  risk: text('risk').notNull().default('LOW'),
  status: text('status').notNull().default('OPEN'),
  source: text('source').notNull(),
  evidence: jsonb('evidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('seo_opportunities_status_idx').on(t.status),
  kindIdx: index('seo_opportunities_kind_idx').on(t.kind),
}));

export const seoChangeLedger = pgTable('seo_change_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  scope: text('scope').notNull(),
  target: text('target').notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  reason: text('reason').notNull(),
  experimentId: uuid('experiment_id'),
  deploymentRef: text('deployment_ref'),
  validationState: text('validation_state').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  occurredIdx: index('seo_change_ledger_occurred_idx').on(t.occurredAt),
}));

export const seoIntegrations = pgTable('seo_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  status: text('status').notNull().default('READY_FOR_CREDENTIALS'),
  config: jsonb('config').notNull().default({}),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
  lastError: text('last_error'),
  syncState: jsonb('sync_state'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerIdx: uniqueIndex('seo_integrations_provider_idx').on(t.provider),
}));

export const seoCrawlRuns = pgTable('seo_crawl_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('RUNNING'),
  scope: text('scope').notNull(),
  pageLimit: integer('page_limit').notNull(),
  pagesCrawled: integer('pages_crawled').notNull().default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const seoCrawlPages = pgTable('seo_crawl_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => seoCrawlRuns.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  finalUrl: text('final_url').notNull(),
  httpStatus: integer('http_status').notNull(),
  redirectChain: jsonb('redirect_chain').notNull().default([]),
  contentType: text('content_type'),
  canonical: text('canonical'),
  metaRobots: text('meta_robots'),
  title: text('title'),
  metaDescription: text('meta_description'),
  h1: text('h1'),
  headings: jsonb('headings'),
  wordCount: integer('word_count'),
  imagesMissingAlt: integer('images_missing_alt'),
  internalLinks: jsonb('internal_links'),
  structuredDataTypes: jsonb('structured_data_types'),
  issues: jsonb('issues'),
  responseMs: integer('response_ms'),
  contentHash: text('content_hash'),
  crawledAt: timestamp('crawled_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  runIdx: index('seo_crawl_pages_run_idx').on(t.runId),
  urlIdx: index('seo_crawl_pages_url_idx').on(t.url),
}));

// NB: the unique edge index in the migration is expression-based
// (from_path, to_path, COALESCE(anchor, '')) so NULL anchors cannot duplicate.
export const seoLinkGraph = pgTable('seo_link_graph', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromPath: text('from_path').notNull(),
  toPath: text('to_path').notNull(),
  anchor: text('anchor'),
  rel: text('rel'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  toPathIdx: index('seo_link_graph_to_path_idx').on(t.toPath),
}));

export const seoAeoPrompts = pgTable('seo_aeo_prompts', {
  id: uuid('id').primaryKey().defaultRandom(),
  prompt: text('prompt').notNull(),
  engine: text('engine').notNull(),
  category: text('category'),
  intent: text('intent'),
  status: text('status').notNull().default('PLANNED'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const seoAeoObservations = pgTable('seo_aeo_observations', {
  id: uuid('id').primaryKey().defaultRandom(),
  promptId: uuid('prompt_id').notNull().references(() => seoAeoPrompts.id),
  engine: text('engine').notNull(),
  modelVersion: text('model_version'),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  responseExcerpt: text('response_excerpt'),
  weMentioned: boolean('we_mentioned').notNull(),
  weCited: boolean('we_cited').notNull(),
  citationUrl: text('citation_url'),
  competitorsMentioned: jsonb('competitors_mentioned').notNull().default([]),
  competitorsCited: jsonb('competitors_cited').notNull().default([]),
  evidenceRef: text('evidence_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  promptIdx: index('seo_aeo_observations_prompt_idx').on(t.promptId, t.executedAt),
}));

export const seoSerpDomains = pgTable('seo_serp_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull(),
  classification: text('classification').notNull().default('UNREVIEWED'),
  competitorId: uuid('competitor_id').references(() => seoCompetitors.id),
  occurrences: integer('occurrences').notNull().default(1),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  domainIdx: uniqueIndex('seo_serp_domains_domain_idx').on(t.domain),
}));

// NB: the migration adds a partial unique index on dedupe_key WHERE status='OPEN'.
export const seoAlerts = pgTable('seo_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  severity: text('severity').notNull(),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  status: text('status').notNull().default('OPEN'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const seoExperiments = pgTable('seo_experiments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  hypothesis: text('hypothesis').notNull(),
  cohort: text('cohort'),
  startAt: timestamp('start_at', { withTimezone: true }),
  endAt: timestamp('end_at', { withTimezone: true }),
  change: text('change').notNull(),
  baseline: jsonb('baseline'),
  metric: text('metric').notNull(),
  result: text('result'),
  confidence: text('confidence'),
  decision: text('decision').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const seoKeywordImports = pgTable('seo_keyword_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  country: text('country').notNull().default('UG'),
  language: text('language').notNull().default('en'),
  methodology: text('methodology'),
  rowCount: integer('row_count').notNull().default(0),
  importedBy: uuid('imported_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
