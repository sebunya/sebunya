import { Hono, type Context } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import {
  SyncWebVitalsUseCase,
  GoogleWebVitalsProvider,
  toVitalsView,
  splitBySource,
  measurementCoverage,
  WEB_VITAL_SOURCES,
  WEB_VITAL_FORM_FACTORS,
  WEB_VITAL_RATINGS,
  WEB_VITAL_THRESHOLDS,
  type WebVitalFormFactor,
} from '../../../../application/use-cases/seo-growth/WebVitalsUseCases';

/**
 * Core Web Vitals admin API (migration 0120).
 *
 * Lab (PageSpeed) and field (CrUX) readings are returned in SEPARATE buckets
 * and are never averaged. There is deliberately no composite "site health"
 * number in this response — one would have to be invented, and it would hide
 * exactly the distinction that makes the two sources useful.
 *
 * A URL with no row comes back as NOT_MEASURED with the reason attached.
 */

const routes = new Hono();

routes.use('*', authMiddleware);

const ok = (c: Context, data: unknown, status = 200) => c.json({ success: true, data }, status as 200);
const bad = (c: Context, code: string, message: string, status = 400) =>
  c.json({ success: false, error: { code, message } }, status as 400);
const json = async (c: Context): Promise<any | null> => c.req.json().catch(() => null);
const actorId = (c: Context): string => (c.get('user') as any).id as string;
const repo = () => Registry.getInstance().seoTechnicalRepo;

/** Platform audit trail — a sync writes measurements, so it is recorded. */
const audit = async (c: Context, action: string, detail: Record<string, unknown>): Promise<void> => {
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: actorId(c),
    action,
    entity: 'seo_web_vitals',
    entityId: String(detail.id ?? ''),
    newState: detail,
  });
};

const formFactorOf = (v: unknown): WebVitalFormFactor =>
  v === 'DESKTOP' ? 'DESKTOP' : v === 'ALL' ? 'ALL' : 'MOBILE';

// ── Vocabulary ──────────────────────────────────────────────────────────────

routes.get('/vocabulary', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) =>
  ok(c, {
    sources: WEB_VITAL_SOURCES,
    formFactors: WEB_VITAL_FORM_FACTORS,
    ratings: WEB_VITAL_RATINGS,
    thresholds: WEB_VITAL_THRESHOLDS,
    sourceMeaning: {
      PAGESPEED_LAB: 'One synthetic Lighthouse run. Diagnostic and reproducible; carries a performance score.',
      CRUX_FIELD: 'Real Chrome-user experience over a 28-day window. A distribution, never a score.',
    },
  }));

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Latest measurement per URL/source/form factor. URLs supplied via ?urls= that
 * have no row are returned explicitly as NOT_MEASURED rather than dropped.
 */
routes.get('/', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const requested = String(c.req.query('urls') ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u !== '');
  const rows = await repo().latestWebVitals({ url: c.req.query('url') || undefined });
  const { lab, field } = splitBySource(rows);

  const urls = Array.from(new Set([...requested, ...rows.map((r: any) => String(r.url))])).sort();
  const formFactor = formFactorOf(c.req.query('formFactor'));

  const pick = (bucket: any[], url: string) =>
    bucket.find((r) => String(r.url) === url && String(r.form_factor) === formFactor) ?? null;

  return ok(c, {
    formFactor,
    // Two buckets, never merged. The UI shows them side by side.
    lab: urls.map((url) => toVitalsView(url, 'PAGESPEED_LAB', formFactor, pick(lab, url))),
    field: urls.map((url) => toVitalsView(url, 'CRUX_FIELD', formFactor, pick(field, url))),
    coverage: measurementCoverage(urls, rows),
    measuredUrlCount: new Set(rows.map((r: any) => String(r.url))).size,
    notMeasuredUrls: urls.filter((u) => !rows.some((r: any) => String(r.url) === u)),
  });
});

routes.get('/history', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const url = c.req.query('url') ?? '';
  if (!url) return bad(c, 'BAD_INPUT', 'A "url" query parameter is required.');
  const rows = await repo().webVitalsHistory(url, Number(c.req.query('limit') ?? 100));
  const { lab, field } = splitBySource(rows);
  return ok(c, {
    url,
    lab,
    field,
    measured: rows.length > 0,
    reason: rows.length > 0 ? null : 'This URL has never been measured. No lab run and no field data exist for it.',
  });
});

routes.get('/urls', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) =>
  ok(c, { items: await repo().measuredUrls() }));

// ── Sync ────────────────────────────────────────────────────────────────────

/**
 * Pull fresh readings from PageSpeed and/or CrUX. Requires a Google API key;
 * without one the endpoint refuses honestly rather than storing placeholders.
 */
routes.post('/sync', requirePermissions([PERMISSIONS.SEO_AUDIT_RUN]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const urls = (Array.isArray(body.urls) ? body.urls : String(body.urls ?? '').split(','))
    .map((u: unknown) => String(u ?? '').trim())
    .filter((u: string) => u !== '');
  if (urls.length === 0) return bad(c, 'URLS_REQUIRED', 'At least one URL is required.', 422);

  const apiKey = (process.env.GOOGLE_PAGESPEED_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim();
  if (apiKey === '') {
    return bad(
      c,
      'CONFIGURATION_ERROR',
      'No Google API key is configured (GOOGLE_PAGESPEED_API_KEY). PageSpeed and CrUX cannot be queried, and no measurement has been invented in their place.',
      422,
    );
  }

  const useCase = new SyncWebVitalsUseCase(new GoogleWebVitalsProvider(apiKey), {
    upsertMeasurement: (m) => repo().upsertWebVital(m),
  });

  const result = await useCase.execute({
    urls,
    formFactors: Array.isArray(body.formFactors) ? body.formFactors : undefined,
    sources: Array.isArray(body.sources) ? body.sources : undefined,
    connectionId: typeof body.connectionId === 'string' ? body.connectionId : null,
  });

  await audit(c, 'SEO_WEB_VITALS_SYNCED', {
    urls, requested: result.requested, stored: result.stored, noData: result.noData, failed: result.failed,
    collectionDate: result.collectionDate,
  });
  return ok(c, result, 201);
});

export default routes;
