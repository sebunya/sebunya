import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Technical SEO governance (migration 0120): robots.txt versioning with
 * approval and rollback, Core Web Vitals measurements, raw-vs-rendered diffs,
 * the SEO work queue and verified crawler hits from server logs.
 *
 * The CHECK constraints that carry the evidence rules live in the hand-written
 * migration; these definitions mirror the shape for the query builder.
 */

export const seoRobotsVersions = pgTable('seo_robots_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: integer('version').notNull(),
  content: text('content').notNull(),
  status: text('status').notNull().default('DRAFT'),
  note: text('note'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  restoredFromId: uuid('restored_from_id'),
}, (t) => ({
  versionIdx: uniqueIndex('seo_robots_versions_version_idx').on(t.version),
}));

export const seoWebVitals = pgTable('seo_web_vitals', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  source: text('source').notNull(),
  formFactor: text('form_factor').notNull(),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
  collectionDate: date('collection_date').notNull(),
  lcpMs: numeric('lcp_ms'),
  inpMs: numeric('inp_ms'),
  cls: numeric('cls'),
  ttfbMs: numeric('ttfb_ms'),
  fcpMs: numeric('fcp_ms'),
  performanceScore: numeric('performance_score'),
  distributions: jsonb('distributions'),
  sampleSize: integer('sample_size'),
  connectionId: uuid('connection_id'),
  raw: jsonb('raw'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  measurementIdx: uniqueIndex('seo_web_vitals_measurement_idx').on(t.url, t.source, t.formFactor, t.collectionDate),
  urlIdx: index('seo_web_vitals_url_idx').on(t.url, t.collectedAt),
}));

export const seoRenderDiffs = pgTable('seo_render_diffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  renderState: text('render_state').notNull().default('NOT_ATTEMPTED'),
  rawStatus: integer('raw_status'),
  rawTitle: text('raw_title'),
  rawMetaDescription: text('raw_meta_description'),
  rawH1: text('raw_h1'),
  rawWordCount: integer('raw_word_count'),
  rawLinkCount: integer('raw_link_count'),
  rawCanonical: text('raw_canonical'),
  rawMetaRobots: text('raw_meta_robots'),
  rawJsonldCount: integer('raw_jsonld_count'),
  renderedTitle: text('rendered_title'),
  renderedMetaDescription: text('rendered_meta_description'),
  renderedH1: text('rendered_h1'),
  renderedWordCount: integer('rendered_word_count'),
  renderedLinkCount: integer('rendered_link_count'),
  renderedCanonical: text('rendered_canonical'),
  renderedMetaRobots: text('rendered_meta_robots'),
  renderedJsonldCount: integer('rendered_jsonld_count'),
  differences: jsonb('differences').notNull().default([]),
  severity: text('severity').notNull().default('NONE'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  urlIdx: index('seo_render_diffs_url_idx').on(t.url, t.observedAt),
  severityIdx: index('seo_render_diffs_severity_idx').on(t.severity, t.observedAt),
}));

export const seoWorkItems = pgTable('seo_work_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  detail: text('detail'),
  state: text('state').notNull().default('BACKLOG'),
  priority: text('priority').notNull().default('MEDIUM'),
  opportunityId: uuid('opportunity_id'),
  gapId: uuid('gap_id'),
  observationId: uuid('observation_id'),
  changeLedgerId: uuid('change_ledger_id'),
  targetUrl: text('target_url'),
  assigneeId: uuid('assignee_id'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  outcome: text('outcome'),
  outcomeNote: text('outcome_note'),
  outcomeMeasuredAt: timestamp('outcome_measured_at', { withTimezone: true }),
}, (t) => ({
  stateIdx: index('seo_work_items_state_idx').on(t.state, t.priority, t.createdAt),
  opportunityIdx: index('seo_work_items_opportunity_idx').on(t.opportunityId),
}));

export const seoCrawlerHits = pgTable('seo_crawler_hits', {
  id: uuid('id').primaryKey().defaultRandom(),
  hitAt: timestamp('hit_at', { withTimezone: true }).notNull(),
  hitDate: date('hit_date').notNull(),
  path: text('path').notNull(),
  crawler: text('crawler').notNull(),
  verification: text('verification').notNull().default('UNVERIFIED'),
  statusCode: integer('status_code'),
  bytes: integer('bytes'),
  responseMs: integer('response_ms'),
  userAgent: text('user_agent'),
  sourceFile: text('source_file'),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dateIdx: index('seo_crawler_hits_date_idx').on(t.hitDate, t.crawler),
  pathIdx: index('seo_crawler_hits_path_idx').on(t.path, t.hitDate),
  verificationIdx: index('seo_crawler_hits_verification_idx').on(t.verification, t.hitDate),
}));

export const seoLogIngestions = pgTable('seo_log_ingestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceName: text('source_name').notNull(),
  format: text('format').notNull(),
  linesRead: integer('lines_read').notNull().default(0),
  linesParsed: integer('lines_parsed').notNull().default(0),
  linesRejected: integer('lines_rejected').notNull().default(0),
  crawlerHits: integer('crawler_hits').notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true }),
  windowEnd: timestamp('window_end', { withTimezone: true }),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  createdIdx: index('seo_log_ingestions_created_idx').on(t.createdAt),
}));
