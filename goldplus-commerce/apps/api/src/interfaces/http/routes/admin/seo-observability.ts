import { Hono, type Context } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { FetchSeoPageFetcher } from '../../../../infrastructure/seo/FetchSeoPageFetcher';
import {
  RunRenderDiffUseCase,
  NotConfiguredSeoPageRenderer,
  describeRenderState,
  normaliseDiffUrl,
  extractSeoFacts,
  compareSeoFacts,
  RENDER_STATES,
  DIFF_SEVERITIES,
  type RawSeoFetcher,
} from '../../../../application/use-cases/seo-growth/RenderDiffUseCases';
import {
  IngestServerLogUseCase,
  NotConfiguredCrawlerVerifier,
  validateIngestInput,
  describeCoverage,
  KNOWN_CRAWLERS,
  CRAWLER_VERIFICATIONS,
  LOG_FORMATS,
  MAX_LOG_BYTES,
  MAX_LOG_LINES,
} from '../../../../application/use-cases/seo-growth/ServerLogSeoUseCases';

/**
 * SEO observability admin API (migration 0120): raw-vs-rendered diffs and
 * server-log crawl budget.
 *
 * Two honesty rules are enforced here rather than left to the UI:
 *  - A diff that was never rendered comes back with severity UNKNOWN and a
 *    sentence saying rendering was not attempted. It is never "no difference".
 *  - Crawler hits carry their verification state, and the verified split is
 *    always returned alongside the totals.
 */

const routes = new Hono();

routes.use('*', authMiddleware);

const ok = (c: Context, data: unknown, status = 200) => c.json({ success: true, data }, status as 200);
const bad = (c: Context, code: string, message: string, status = 400) =>
  c.json({ success: false, error: { code, message } }, status as 400);
const json = async (c: Context): Promise<any | null> => c.req.json().catch(() => null);
const actorId = (c: Context): string => (c.get('user') as any).id as string;

/** Wired on the Registry as `seoObservabilityRepo`. */
const repo = () => Registry.getInstance().seoObservabilityRepo;

/** Platform audit trail — every admin mutation here is recorded. */
const audit = async (c: Context, action: string, detail: Record<string, unknown>): Promise<void> => {
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: actorId(c),
    action,
    entity: 'seo_observability',
    entityId: String(detail.id ?? detail.url ?? detail.sourceName ?? ''),
    newState: detail,
  });
};

// There is no headless browser in this deployment, and none is added here: the
// renderer port reports NOT_ATTEMPTED honestly. Likewise no DNS verifier is
// configured, so crawler hits stay UNVERIFIED / NOT_CHECKED.
const renderer = new NotConfiguredSeoPageRenderer();
const verifier = new NotConfiguredCrawlerVerifier();
const fetcher: RawSeoFetcher = new FetchSeoPageFetcher() as unknown as RawSeoFetcher;

// ── Vocabulary ──────────────────────────────────────────────────────────────

routes.get('/vocabulary', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) =>
  ok(c, {
    renderStates: RENDER_STATES,
    severities: DIFF_SEVERITIES,
    crawlers: KNOWN_CRAWLERS,
    verifications: CRAWLER_VERIFICATIONS,
    logFormats: LOG_FORMATS,
    limits: { maxLogBytes: MAX_LOG_BYTES, maxLogLines: MAX_LOG_LINES },
    rendererConfigured: false,
    verifierConfigured: false,
  }));

// ── Raw vs rendered ─────────────────────────────────────────────────────────

routes.get('/render-diff', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const [items, summary] = await Promise.all([
    repo().listRenderDiffs({
      url: c.req.query('url') || undefined,
      severity: c.req.query('severity') || undefined,
      limit: Number(c.req.query('limit')) || undefined,
    }),
    repo().renderDiffSummary(),
  ]);
  return ok(c, {
    items: items.map((row: any) => ({ ...row, stateNote: describeRenderState(row.render_state, row.error) })),
    summary,
    rendererConfigured: false,
    rendererNote:
      'No rendering engine is configured. Raw HTML is captured; the post-JavaScript view is NOT observed, so these rows record NOT_ATTEMPTED with severity UNKNOWN — not "no difference found".',
  });
});

routes.post('/render-diff', requirePermissions([PERMISSIONS.SEO_AUDIT_RUN]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const url = normaliseDiffUrl(body.url);
  if (!url) return bad(c, 'BAD_URL', 'Provide an absolute http(s) URL to diff.');

  const useCase = new RunRenderDiffUseCase(fetcher, renderer, repo());
  const record = await useCase.execute({ url });
  await audit(c, 'SEO_RENDER_DIFF_RUN', {
    url, renderState: record.renderState, severity: record.severity, rawStatus: record.rawStatus,
  });
  return ok(c, { ...record, stateNote: describeRenderState(record.renderState, record.error) }, 201);
});

/**
 * Compare two HTML documents supplied by the operator (for example, view-source
 * versus a browser copy). Pure computation — nothing is fetched or stored.
 */
routes.post('/render-diff/compare', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  if (typeof body.rawHtml !== 'string' || typeof body.renderedHtml !== 'string') {
    return bad(c, 'BAD_INPUT', 'Both rawHtml and renderedHtml are required strings.');
  }
  if (body.rawHtml.length > MAX_LOG_BYTES || body.renderedHtml.length > MAX_LOG_BYTES) {
    return bad(c, 'PAYLOAD_TOO_LARGE', 'HTML payloads exceed the accepted size.', 413);
  }
  const raw = extractSeoFacts(body.rawHtml);
  const rendered = extractSeoFacts(body.renderedHtml);
  return ok(c, { raw, rendered, ...compareSeoFacts(raw, rendered) });
});

// ── Server-log crawl budget ─────────────────────────────────────────────────

routes.get('/crawler-hits', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const days = Number(c.req.query('days')) || 30;
  const [budget, hits, ingestions] = await Promise.all([
    repo().crawlBudget(days),
    repo().listCrawlerHits({
      crawler: c.req.query('crawler') || undefined,
      verification: c.req.query('verification') || undefined,
      days,
      limit: Number(c.req.query('limit')) || undefined,
    }),
    repo().listLogIngestions(25),
  ]);
  return ok(c, {
    budget,
    items: hits,
    ingestions,
    verifierConfigured: false,
    coverage: describeCoverage(budget.window.firstHitAt, budget.window.lastHitAt),
    verificationNote:
      'A crawler user-agent string is a claim, not proof. Only rows marked VERIFIED passed a reverse-DNS-then-forward-confirm check; UNVERIFIED and NOT_CHECKED rows are not confirmed crawler activity.',
  });
});

routes.get('/ingestions', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) =>
  ok(c, { items: await repo().listLogIngestions(Number(c.req.query('limit')) || 50) }));

routes.post('/ingest-log', requirePermissions([PERMISSIONS.SEO_AUDIT_RUN]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const validation = validateIngestInput(body);
  if (!validation.ok) {
    return bad(c, validation.code, validation.message, validation.code === 'LOG_TOO_LARGE' ? 413 : 400);
  }

  const useCase = new IngestServerLogUseCase(repo(), verifier);
  const result = await useCase.execute({
    text: validation.text,
    sourceName: validation.sourceName,
    format: validation.format,
    actorId: actorId(c),
  });

  await audit(c, 'SEO_SERVER_LOG_INGESTED', {
    id: result.ingestionId,
    sourceName: validation.sourceName,
    format: validation.format,
    linesRead: result.linesRead,
    linesParsed: result.linesParsed,
    linesRejected: result.linesRejected,
    crawlerHits: result.crawlerHits,
    windowStart: result.windowStart ? result.windowStart.toISOString() : null,
    windowEnd: result.windowEnd ? result.windowEnd.toISOString() : null,
  });

  return ok(c, result, 201);
});

export default routes;
