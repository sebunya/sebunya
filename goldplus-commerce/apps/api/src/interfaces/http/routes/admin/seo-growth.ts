import { Hono, Context } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { QueueService, QUEUES } from '../../../../infrastructure/queues/QueueService';
import { logger } from '../../../../infrastructure/logging/logger';
import { GenerateSeoOpportunitiesUseCase } from '../../../../application/use-cases/seo-growth/GenerateSeoOpportunitiesUseCase';
import { ImportSeoKeywordCsvUseCase, normalizeQuery } from '../../../../application/use-cases/seo-growth/ImportSeoKeywordCsvUseCase';
import { SyncSeoIntegrationStatusesUseCase } from '../../../../application/use-cases/seo-growth/SyncSeoIntegrationStatusesUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Organic Growth OS — admin API (mounted at /admin/seo).
 *
 * Thin Hono routes over DrizzleSeoGrowthRepository and the seo-growth use
 * cases. Every response is { success: true, data } / { success: false, error }
 * — the web workspace depends on that exact shape.
 *
 * Permission map:
 *   seo.view                — every GET
 *   seo.competitors.manage  — competitor upsert / classify / merge
 *   seo.serp.manage         — query upsert, CSV import, SERP + AEO evidence, gaps
 *   seo.audit.run           — crawl start, opportunity generation
 *   seo.experiments.manage  — experiments
 *   seo.integrations.manage — (reserved: integration status is computed, not edited)
 *   any seo.*.manage        — change-ledger append
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = (c: Context, data: unknown, status = 200) =>
  c.json({ success: true, data } as ApiResponse<unknown>, status as never);
const bad = (c: Context, code: string, message: string, status = 400) =>
  c.json({ success: false, error: { code, message } } as ApiResponse<never>, status as never);

const json = async (c: Context): Promise<any | null> => c.req.json().catch(() => null);

const SEO_MANAGE_PERMISSIONS: string[] = [
  PERMISSIONS.SEO_METADATA_MANAGE,
  PERMISSIONS.SEO_REDIRECTS_MANAGE,
  PERMISSIONS.SEO_ROBOTS_MANAGE,
  PERMISSIONS.SEO_COMPETITORS_MANAGE,
  PERMISSIONS.SEO_SERP_MANAGE,
  PERMISSIONS.SEO_INTEGRATIONS_MANAGE,
  PERMISSIONS.SEO_EXPERIMENTS_MANAGE,
];

/** ANY-of gate (requirePermissions is ALL-of): used by the change ledger. */
const requirePermissionsAnySeoManage = async (c: Context, next: () => Promise<void>) => {
  const user = c.get('user') as { id: string; permissions: string[] } | undefined;
  if (!user) return bad(c, 'UNAUTHENTICATED', 'User not authenticated.', 401);
  const granted = new Set(user.permissions);
  if (!SEO_MANAGE_PERMISSIONS.some((p) => granted.has(p))) {
    logger.warn({ actorId: user.id, path: c.req.path }, 'AUTHZ_DENIED');
    return bad(c, 'FORBIDDEN', 'Insufficient permissions to perform this action.', 403);
  }
  await next();
};

const actorId = (c: Context): string => (c.get('user') as any).id as string;

/** 0118: provider ids holding an ACTIVE vault credential (defensive: [] when the control plane is unavailable). */
const vaultConfiguredProviders = async (): Promise<string[]> => {
  try {
    return await Registry.getInstance().seoIntegrationRepo.listVaultConfiguredProviders();
  } catch {
    return [];
  }
};

/** Every mutation lands in the platform audit trail as well as the SEO change ledger. */
const audit = async (c: Context, action: string, entity: string, entityId: string, newState?: Record<string, unknown>) => {
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: actorId(c),
    action,
    entity,
    entityId,
    newState: newState ?? null,
  });
};

// ── Overview ────────────────────────────────────────────────────────────────

routes.get('/overview', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const repo = Registry.getInstance().seoGrowthRepo;
  const [marketShare, counts, crawlRuns, integrations, openAlerts] = await Promise.all([
    repo.marketShare(30),
    repo.overviewCounts(),
    repo.listCrawlRuns(1),
    vaultConfiguredProviders().then((vaultIds) =>
      new SyncSeoIntegrationStatusesUseCase(repo, process.env, vaultIds).execute()),
    repo.listAlerts({ status: 'OPEN', limit: 20 }),
  ]);
  return ok(c, {
    marketShare,
    openOpportunities: counts.openOpportunities,
    openAlertsCount: counts.openAlerts,
    openAlerts,
    competitors: counts.competitors,
    candidateCompetitors: counts.candidateCompetitors,
    trackedQueries: counts.trackedQueries,
    latestCrawlRun: crawlRuns[0] ?? null,
    integrations,
  });
});

// ── Competitors ─────────────────────────────────────────────────────────────

routes.get('/competitors', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const repo = Registry.getInstance().seoGrowthRepo;
  const rows = await repo.listCompetitors({
    status: c.req.query('status') || undefined,
    directness: c.req.query('directness') || undefined,
    businessType: c.req.query('businessType') || undefined,
    search: c.req.query('search') || undefined,
  });
  return ok(c, rows);
});

routes.post('/competitors', requirePermissions([PERMISSIONS.SEO_COMPETITORS_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body || typeof body.canonicalName !== 'string' || body.canonicalName.trim() === '') {
    return bad(c, 'BAD_INPUT', 'canonicalName is required.');
  }
  const row = await Registry.getInstance().seoGrowthRepo.upsertCompetitor(body);
  await audit(c, 'SEO_COMPETITOR_UPSERTED', 'seo_competitor', String(row?.id ?? ''), { canonicalName: body.canonicalName });
  return ok(c, row, 201);
});

routes.patch('/competitors/:id', requirePermissions([PERMISSIONS.SEO_COMPETITORS_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const repo = Registry.getInstance().seoGrowthRepo;
  const id = (c.req.param('id') ?? '');
  const existingList = await repo.listCompetitors();
  const existing = existingList.find((r: any) => r.id === id);
  if (!existing) return bad(c, 'NOT_FOUND', 'Competitor not found.', 404);

  // Classification / merge only mutate governed fields; everything else keeps its value.
  const status = typeof body.status === 'string' ? body.status : existing.status;
  if (!['ACTIVE', 'CANDIDATE', 'IGNORED', 'MERGED'].includes(status)) {
    return bad(c, 'BAD_INPUT', 'status must be ACTIVE, CANDIDATE, IGNORED or MERGED.');
  }
  if (status === 'MERGED' && !(typeof body.mergedIntoId === 'string' || existing.merged_into_id)) {
    return bad(c, 'BAD_INPUT', 'Merging requires mergedIntoId.');
  }
  const row = await repo.upsertCompetitor({
    canonicalName: existing.canonical_name,
    aliases: Array.isArray(body.aliases) ? body.aliases : existing.aliases,
    domains: Array.isArray(body.domains) ? body.domains : existing.domains,
    businessType: typeof body.businessType === 'string' ? body.businessType : existing.business_type,
    country: body.country !== undefined ? body.country : existing.country,
    ugandaRelevance: typeof body.ugandaRelevance === 'string' ? body.ugandaRelevance : existing.uganda_relevance,
    localPresence: body.localPresence !== undefined ? body.localPresence : existing.local_presence,
    productOverlap: Array.isArray(body.productOverlap) ? body.productOverlap : existing.product_overlap,
    categoryOverlap: Array.isArray(body.categoryOverlap) ? body.categoryOverlap : existing.category_overlap,
    b2bRelevant: body.b2bRelevant !== undefined ? body.b2bRelevant : existing.b2b_relevant,
    isMarketplace: body.isMarketplace !== undefined ? Boolean(body.isMarketplace) : existing.is_marketplace,
    isBrand: body.isBrand !== undefined ? Boolean(body.isBrand) : existing.is_brand,
    directness: typeof body.directness === 'string' ? body.directness : existing.directness,
    status,
    mergedIntoId: status === 'MERGED' ? (body.mergedIntoId ?? existing.merged_into_id) : null,
    evidenceSource: body.evidenceSource !== undefined ? body.evidenceSource : existing.evidence_source,
    evidenceState: typeof body.evidenceState === 'string' ? body.evidenceState : existing.evidence_state,
    lastVerifiedAt: body.lastVerifiedAt ? new Date(body.lastVerifiedAt) : existing.last_verified_at,
  });
  await audit(c, 'SEO_COMPETITOR_CLASSIFIED', 'seo_competitor', id, { status, mergedIntoId: row?.merged_into_id ?? null });
  return ok(c, row);
});

// ── Queries ─────────────────────────────────────────────────────────────────

routes.get('/queries', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const repo = Registry.getInstance().seoGrowthRepo;
  const result = await repo.listQueries({
    priority: c.req.query('priority') || undefined,
    intent: c.req.query('intent') || undefined,
    category: c.req.query('category') || undefined,
    source: c.req.query('source') || undefined,
    search: c.req.query('search') || undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
  });
  return ok(c, result);
});

routes.post('/queries', requirePermissions([PERMISSIONS.SEO_SERP_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body || typeof body.query !== 'string' || body.query.trim() === '') {
    return bad(c, 'BAD_INPUT', 'query is required.');
  }
  if (typeof body.source !== 'string' || body.source.trim() === '') {
    return bad(c, 'BAD_INPUT', 'source is required (where this query fact came from).');
  }
  const row = await Registry.getInstance().seoGrowthRepo.upsertQuery({
    ...body,
    query: body.query.trim(),
    normalizedQuery: normalizeQuery(body.query),
    lastObservedAt: body.lastObservedAt ? new Date(body.lastObservedAt) : undefined,
  });
  await audit(c, 'SEO_QUERY_UPSERTED', 'seo_query', String(row?.id ?? ''), { normalizedQuery: row?.normalized_query });
  return ok(c, row, 201);
});

routes.post('/queries/import-csv', requirePermissions([PERMISSIONS.SEO_SERP_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const repo = Registry.getInstance().seoGrowthRepo;
  const uc = new ImportSeoKeywordCsvUseCase({
    upsertQuery: (q) => repo.upsertQuery(q),
    recordKeywordImport: (r) => repo.recordKeywordImport(r),
  });
  const result = await uc.execute({
    provider: String(body.provider ?? ''),
    country: body.country ? String(body.country) : undefined,
    language: body.language ? String(body.language) : undefined,
    methodology: body.methodology ? String(body.methodology) : null,
    importedBy: actorId(c),
    rows: Array.isArray(body.rows) ? body.rows : [],
  });
  if (!result.ok) return bad(c, result.code, result.message);
  await audit(c, 'SEO_KEYWORDS_IMPORTED', 'seo_keyword_import', String(result.importId ?? ''), { imported: result.imported, skipped: result.skipped.length });
  return ok(c, result, 201);
});

// ── SERP observations ───────────────────────────────────────────────────────

routes.get('/serp', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const queryId = c.req.query('queryId');
  if (!queryId) return bad(c, 'BAD_INPUT', 'queryId is required.');
  const rows = await Registry.getInstance().seoGrowthRepo.listSerpObservations(queryId, {
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
  });
  return ok(c, rows);
});

routes.post('/serp/observations', requirePermissions([PERMISSIONS.SEO_SERP_MANAGE]), async (c) => {
  const body = await json(c);
  const batch = Array.isArray(body?.observations) ? body.observations : Array.isArray(body) ? body : null;
  if (!batch || batch.length === 0) return bad(c, 'BAD_INPUT', 'observations must be a non-empty array.');
  if (batch.length > 1000) return bad(c, 'TOO_MANY_ROWS', 'At most 1000 observations per batch.');
  for (const o of batch) {
    if (typeof o?.queryId !== 'string' || typeof o?.provider !== 'string' || !o?.observedAt) {
      return bad(c, 'BAD_INPUT', 'Each observation needs queryId, provider and observedAt.');
    }
  }
  const result = await Registry.getInstance().seoGrowthRepo.recordSerpObservations(
    batch.map((o: any) => ({ ...o, observedAt: new Date(o.observedAt) })),
  );
  await audit(c, 'SEO_SERP_OBSERVATIONS_RECORDED', 'seo_serp_observation', 'batch', { inserted: result.inserted, candidatesCreated: result.candidatesCreated });
  return ok(c, result, 201);
});

// ── Market share ────────────────────────────────────────────────────────────

routes.get('/market-share', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const windowDays = c.req.query('windowDays') ? Number(c.req.query('windowDays')) : 30;
  const result = await Registry.getInstance().seoGrowthRepo.marketShare(windowDays);
  return ok(c, result);
});

// ── Opportunities ───────────────────────────────────────────────────────────

routes.get('/opportunities', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const rows = await Registry.getInstance().seoGrowthRepo.listOpportunities({
    status: c.req.query('status') || undefined,
    kind: c.req.query('kind') || undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
  });
  return ok(c, rows);
});

routes.post('/opportunities', requirePermissions([PERMISSIONS.SEO_SERP_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body || typeof body.kind !== 'string' || typeof body.title !== 'string' || typeof body.detail !== 'string') {
    return bad(c, 'BAD_INPUT', 'kind, title and detail are required.');
  }
  const row = await Registry.getInstance().seoGrowthRepo.upsertOpportunity({ ...body, source: body.source ?? 'OPERATOR' });
  await audit(c, 'SEO_OPPORTUNITY_CREATED', 'seo_opportunity', String(row?.id ?? ''), { kind: body.kind });
  return ok(c, row, 201);
});

routes.patch('/opportunities/:id', requirePermissions([PERMISSIONS.SEO_SERP_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const repo = Registry.getInstance().seoGrowthRepo;
  if (body.status === 'DISMISSED') {
    const done = await repo.dismissOpportunity((c.req.param('id') ?? ''));
    if (!done) return bad(c, 'NOT_FOUND', 'Opportunity not found.', 404);
    await audit(c, 'SEO_OPPORTUNITY_DISMISSED', 'seo_opportunity', (c.req.param('id') ?? ''));
    return ok(c, { dismissed: true });
  }
  if (typeof body.kind !== 'string' || typeof body.title !== 'string' || typeof body.detail !== 'string') {
    return bad(c, 'BAD_INPUT', 'kind, title and detail are required for an update.');
  }
  const row = await repo.upsertOpportunity({ ...body, id: (c.req.param('id') ?? ''), source: body.source ?? 'OPERATOR' });
  if (!row) return bad(c, 'NOT_FOUND', 'Opportunity not found.', 404);
  return ok(c, row);
});

routes.post('/opportunities/generate', requirePermissions([PERMISSIONS.SEO_AUDIT_RUN]), async (c) => {
  const body = (await json(c)) ?? {};
  const repo = Registry.getInstance().seoGrowthRepo;
  const uc = new GenerateSeoOpportunitiesUseCase({
    gscRows: (d) => repo.gscOpportunityRows(d),
    products: () => repo.productAttributeGapRows(),
    latestCrawlIssuePages: () => repo.latestCrawlIssuePages(),
    linkGraphStats: () => repo.linkGraphStats(),
    listOpenOpportunities: async () => {
      const rows = await repo.listOpportunities({ status: 'OPEN', limit: 500 });
      return rows.map((r: any) => ({ id: r.id, kind: r.kind, url: r.url ?? null, evidence: r.evidence }));
    },
    upsertOpportunity: (o) => repo.upsertOpportunity(o as any),
  });
  const result = await uc.execute({ windowDays: body.windowDays ? Number(body.windowDays) : undefined });
  await audit(c, 'SEO_OPPORTUNITIES_GENERATED', 'seo_opportunity', 'generator', { created: result.created, updated: result.updated, countsPerKind: result.countsPerKind });
  return ok(c, result);
});

// ── Gap records ─────────────────────────────────────────────────────────────

routes.get('/gaps', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const rows = await Registry.getInstance().seoGrowthRepo.listGapRecords({
    status: c.req.query('status') || undefined,
    queryId: c.req.query('queryId') || undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
  });
  return ok(c, rows);
});

routes.post('/gaps', requirePermissions([PERMISSIONS.SEO_SERP_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body || (body.id == null && typeof body.queryId !== 'string')) {
    return bad(c, 'BAD_INPUT', 'queryId is required for a new gap record.');
  }
  const row = await Registry.getInstance().seoGrowthRepo.upsertGapRecord(body);
  if (!row) return bad(c, 'NOT_FOUND', 'Gap record not found.', 404);
  await audit(c, 'SEO_GAP_RECORD_UPSERTED', 'seo_gap_record', String(row?.id ?? ''));
  return ok(c, row, body.id ? 200 : 201);
});

// ── Change ledger ───────────────────────────────────────────────────────────

routes.get('/change-ledger', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const rows = await Registry.getInstance().seoGrowthRepo.listChangeLedger({
    scope: c.req.query('scope') || undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
  });
  return ok(c, rows);
});

routes.post('/change-ledger', requirePermissionsAnySeoManage, async (c) => {
  const body = await json(c);
  if (!body || typeof body.scope !== 'string' || typeof body.target !== 'string' || typeof body.reason !== 'string') {
    return bad(c, 'BAD_INPUT', 'scope, target and reason are required.');
  }
  const row = await Registry.getInstance().seoGrowthRepo.appendChangeLedger({
    ...body,
    actorId: actorId(c),
    occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
  });
  await audit(c, 'SEO_CHANGE_LEDGER_APPENDED', 'seo_change_ledger', String(row?.id ?? ''), { scope: body.scope, target: body.target });
  return ok(c, row, 201);
});

// ── Integrations ────────────────────────────────────────────────────────────

routes.get('/integrations', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const uc = new SyncSeoIntegrationStatusesUseCase(
    Registry.getInstance().seoGrowthRepo,
    process.env,
    await vaultConfiguredProviders(),
  );
  return ok(c, await uc.execute());
});

routes.post('/integrations/gsc/sync', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_MANAGE]), async (c) => {
  // Honest no-op path: without credentials (vault OR env — 0118 is vault-first)
  // nothing is enqueued and nothing pretends to run.
  const hasEnvCredentials =
    (process.env.GSC_SERVICE_ACCOUNT_JSON ?? '').trim() !== '' &&
    (process.env.GSC_SITE_URL ?? '').trim() !== '';
  const hasVaultCredentials = (await vaultConfiguredProviders()).includes('google-search-console');
  if (!hasEnvCredentials && !hasVaultCredentials) {
    return ok(c, {
      status: 'READY_FOR_CREDENTIALS',
      message: 'GSC is not configured. Add a Google Search Console connection with a credential in the Integrations control plane (or set GSC_SERVICE_ACCOUNT_JSON and GSC_SITE_URL) to enable syncing.',
    });
  }
  const queue = QueueService.getInstance().getQueue(QUEUES.ANALYTICS_FANOUT);
  if (!queue) return bad(c, 'QUEUE_UNAVAILABLE', 'Background queue is not available; sync not started.', 503);
  await queue.add('seo-gsc-sync', { requestedBy: actorId(c) });
  await audit(c, 'SEO_GSC_SYNC_ENQUEUED', 'seo_integration', 'GSC');
  return ok(c, { enqueued: true }, 202);
});

routes.post('/integrations/indexnow/submit', requirePermissions([PERMISSIONS.SEO_INTEGRATIONS_MANAGE]), async (c) => {
  const body = await json(c);
  const urls = Array.isArray(body?.urls) ? body.urls.map(String) : null;
  if (!urls || urls.length === 0) return bad(c, 'BAD_INPUT', 'urls must be a non-empty array.');
  const { SubmitIndexNowUseCase } = await import('../../../../application/use-cases/seo-growth/SubmitIndexNowUseCase');
  const { IndexNowClient } = await import('../../../../infrastructure/seo/IndexNowClient');
  // 0118: the IndexNow key resolves vault-first, env-second (bootstrap/emergency).
  let indexNowKey = (process.env.INDEXNOW_KEY ?? '').trim();
  try {
    const intRepo = Registry.getInstance().seoIntegrationRepo;
    const connection = await intRepo.findConnectionWithActiveCredential('indexnow');
    if (connection) {
      const { IntegrationCredentialVault } = await import('../../../../infrastructure/seo/IntegrationCredentialVault');
      const vault = IntegrationCredentialVault.fromEnv();
      const credential = await intRepo.getActiveCredential(connection.id);
      if (vault && credential) {
        const secret = vault.decrypt<Record<string, unknown>>(credential.ciphertext);
        if (typeof secret.apiKey === 'string' && secret.apiKey.trim() !== '') indexNowKey = secret.apiKey.trim();
      }
    }
  } catch { /* vault unavailable — env fallback stands */ }
  const result = await new SubmitIndexNowUseCase(new IndexNowClient(), { ...process.env, INDEXNOW_KEY: indexNowKey }).execute(urls);
  if (result.status === 'REJECTED') return bad(c, 'BAD_INPUT', result.reason);
  await audit(c, 'SEO_INDEXNOW_SUBMITTED', 'seo_integration', 'INDEXNOW', { result: result.status, urlCount: urls.length });
  return ok(c, result);
});

// ── Merchant feed quality ───────────────────────────────────────────────────

routes.get('/merchant/feed-quality', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const { FeedQualityUseCase } = await import('../../../../application/use-cases/seo-growth/MerchantFeedUseCase');
  const repo = Registry.getInstance().seoGrowthRepo;
  const report = await new FeedQualityUseCase(() => repo.feedProducts()).execute();
  return ok(c, report);
});

// ── Alerts ──────────────────────────────────────────────────────────────────

routes.get('/alerts', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const rows = await Registry.getInstance().seoGrowthRepo.listAlerts({
    status: c.req.query('status') || undefined,
    severity: c.req.query('severity') || undefined,
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
  });
  return ok(c, rows);
});

routes.post('/alerts/:id/acknowledge', requirePermissionsAnySeoManage, async (c) => {
  const done = await Registry.getInstance().seoGrowthRepo.acknowledgeAlert((c.req.param('id') ?? ''));
  if (!done) return bad(c, 'NOT_FOUND', 'Alert not found or not OPEN.', 404);
  await audit(c, 'SEO_ALERT_ACKNOWLEDGED', 'seo_alert', (c.req.param('id') ?? ''));
  return ok(c, { acknowledged: true });
});

routes.post('/alerts/:id/resolve', requirePermissionsAnySeoManage, async (c) => {
  const done = await Registry.getInstance().seoGrowthRepo.resolveAlert((c.req.param('id') ?? ''));
  if (!done) return bad(c, 'NOT_FOUND', 'Alert not found or already resolved.', 404);
  await audit(c, 'SEO_ALERT_RESOLVED', 'seo_alert', (c.req.param('id') ?? ''));
  return ok(c, { resolved: true });
});

// ── Experiments ─────────────────────────────────────────────────────────────

routes.get('/experiments', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const rows = await Registry.getInstance().seoGrowthRepo.listExperiments(
    c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
  );
  return ok(c, rows);
});

routes.post('/experiments', requirePermissions([PERMISSIONS.SEO_EXPERIMENTS_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body || typeof body.name !== 'string' || typeof body.hypothesis !== 'string'
    || typeof body.change !== 'string' || typeof body.metric !== 'string') {
    return bad(c, 'BAD_INPUT', 'name, hypothesis, change and metric are required.');
  }
  const row = await Registry.getInstance().seoGrowthRepo.createExperiment({
    ...body,
    startAt: body.startAt ? new Date(body.startAt) : null,
    endAt: body.endAt ? new Date(body.endAt) : null,
  });
  await audit(c, 'SEO_EXPERIMENT_CREATED', 'seo_experiment', String(row?.id ?? ''), { name: body.name });
  return ok(c, row, 201);
});

// ── AEO ─────────────────────────────────────────────────────────────────────

routes.get('/aeo', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const repo = Registry.getInstance().seoGrowthRepo;
  const prompts = await repo.listAeoPrompts({
    engine: c.req.query('engine') || undefined,
    status: c.req.query('status') || undefined,
  });
  const observations = await repo.listAeoObservations(c.req.query('promptId') || undefined);
  return ok(c, { prompts, observations });
});

routes.get('/aeo/coverage', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  return ok(c, await Registry.getInstance().seoGrowthRepo.aeoCoverage());
});

routes.post('/aeo/prompts', requirePermissions([PERMISSIONS.SEO_SERP_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body || typeof body.prompt !== 'string' || typeof body.engine !== 'string') {
    return bad(c, 'BAD_INPUT', 'prompt and engine are required.');
  }
  const row = await Registry.getInstance().seoGrowthRepo.createAeoPrompt(body);
  await audit(c, 'SEO_AEO_PROMPT_CREATED', 'seo_aeo_prompt', String(row?.id ?? ''), { engine: body.engine });
  return ok(c, row, 201);
});

routes.post('/aeo/observations', requirePermissions([PERMISSIONS.SEO_SERP_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body || typeof body.promptId !== 'string' || typeof body.engine !== 'string'
    || typeof body.weMentioned !== 'boolean' || typeof body.weCited !== 'boolean') {
    return bad(c, 'BAD_INPUT', 'promptId, engine, weMentioned and weCited are required — record only what was actually observed.');
  }
  const row = await Registry.getInstance().seoGrowthRepo.recordAeoObservation({
    ...body,
    executedAt: body.executedAt ? new Date(body.executedAt) : undefined,
  });
  await audit(c, 'SEO_AEO_OBSERVATION_RECORDED', 'seo_aeo_observation', String(row?.id ?? ''), { engine: body.engine, weMentioned: body.weMentioned, weCited: body.weCited });
  return ok(c, row, 201);
});

// ── Crawl ───────────────────────────────────────────────────────────────────

routes.post('/crawl/start', requirePermissions([PERMISSIONS.SEO_AUDIT_RUN]), async (c) => {
  const body = (await json(c)) ?? {};
  const repo = Registry.getInstance().seoGrowthRepo;
  const running = (await repo.listCrawlRuns(5)).find((r: any) => r.status === 'RUNNING');
  if (running) return bad(c, 'ALREADY_RUNNING', `Crawl ${running.id} is already RUNNING.`, 409);

  const maxPages = Math.min(Math.max(Number(body.maxPages) || 200, 1), 2000);
  const run = await repo.createCrawlRun({
    scope: typeof body.scope === 'string' && body.scope.trim() !== '' ? body.scope : 'FULL_SITE',
    pageLimit: maxPages,
    notes: body.notes ? String(body.notes) : null,
  });

  const queue = QueueService.getInstance().getQueue(QUEUES.ANALYTICS_FANOUT);
  if (!queue) {
    await repo.finishCrawlRun(run.id, { status: 'FAILED', pagesCrawled: 0, notes: 'Queue unavailable — crawl never started.' });
    return bad(c, 'QUEUE_UNAVAILABLE', 'Background queue is not available; crawl not started.', 503);
  }
  await queue.add('seo-crawl', {
    runId: run.id,
    maxPages,
    startUrl: typeof body.startUrl === 'string' ? body.startUrl : undefined,
  });
  await audit(c, 'SEO_CRAWL_STARTED', 'seo_crawl_run', String(run.id), { maxPages });
  return ok(c, run, 202);
});

routes.get('/crawl/runs', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const rows = await Registry.getInstance().seoGrowthRepo.listCrawlRuns(
    c.req.query('limit') ? Number(c.req.query('limit')) : 50,
  );
  return ok(c, rows);
});

routes.get('/crawl/runs/:id/pages', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const result = await Registry.getInstance().seoGrowthRepo.listCrawlPages((c.req.param('id') ?? ''), {
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
  });
  return ok(c, result);
});

routes.post('/crawl/:id/cancel', requirePermissions([PERMISSIONS.SEO_AUDIT_RUN]), async (c) => {
  const done = await Registry.getInstance().seoGrowthRepo.markCrawlRunCancelled((c.req.param('id') ?? ''));
  if (!done) return bad(c, 'NOT_RUNNING', 'Run not found or not RUNNING.', 404);
  await audit(c, 'SEO_CRAWL_CANCELLED', 'seo_crawl_run', (c.req.param('id') ?? ''));
  return ok(c, { cancelled: true });
});

export default routes;
