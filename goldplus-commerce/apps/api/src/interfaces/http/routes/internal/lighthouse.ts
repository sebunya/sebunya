import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { Registry } from '../../../../infrastructure/Registry';
import { logger } from '../../../../infrastructure/logging/logger';
import { describeShortfall, targetsFromEnv, type LighthouseFormFactor, type LighthouseRunner } from '../../../../application/use-cases/seo-growth/LighthouseWatchUseCases';

/**
 * Lighthouse Watch ingest (2026-09-13). The host runner
 * (scripts/lighthouse-watch.sh) runs real Lighthouse against the live site and
 * posts the results here. Not an admin session: a machine-to-machine token,
 * LIGHTHOUSE_WATCH_TOKEN, compared in constant time. With no token configured
 * the endpoint refuses with 503 NOT_CONFIGURED — it never accepts anonymous
 * reports and never stores placeholders.
 */
const routes = new Hono();

function tokenMatches(presented: string | undefined): boolean {
  const expected = (process.env.LIGHTHOUSE_WATCH_TOKEN ?? '').trim();
  if (expected.length < 32 || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

routes.post('/report', async (c) => {
  if ((process.env.LIGHTHOUSE_WATCH_TOKEN ?? '').trim().length < 32) {
    return c.json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'LIGHTHOUSE_WATCH_TOKEN is not set (32+ characters).' } }, 503);
  }
  if (!tokenMatches(c.req.header('x-lighthouse-watch-token'))) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Bad watch token.' } }, 401);
  }
  const body = await c.req.json().catch(() => null) as { reports?: unknown; collectionDate?: unknown } | null;
  const reportsIn = Array.isArray(body?.reports) ? body!.reports as Array<{ formFactor?: unknown; lhr?: unknown; runner?: unknown }> : [];
  if (reportsIn.length === 0 || reportsIn.length > 12) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'reports must be a list of 1 to 12 { formFactor, lhr } entries.' } }, 400);
  }
  const reports = reportsIn.map((r) => ({
    formFactor: (r.formFactor === 'DESKTOP' ? 'DESKTOP' : 'MOBILE') as LighthouseFormFactor,
    lhr: r.lhr,
    runner: (r.runner === 'pagespeed-api' ? 'pagespeed-api' : 'lighthouse-cli') as LighthouseRunner,
  }));
  const collectionDate = typeof body?.collectionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.collectionDate)
    ? body.collectionDate
    : new Date().toISOString().slice(0, 10);
  const registry = Registry.getInstance();
  const result = await registry.recordLighthouseReportUseCase.execute({
    reports,
    collectionDate,
    targets: targetsFromEnv((k) => process.env[k]),
  });
  const scores = result.summaries.map((s) => ({ url: s.url, formFactor: s.formFactor, ...s.categories }));
  if (result.ok) {
    logger.info({ scores }, '[lighthouse-watch] every category at target');
  } else {
    logger.error(
      { scores, shortfalls: result.shortfalls.map(describeShortfall) },
      `ALERT LIGHTHOUSE_BELOW_TARGET — ${result.shortfalls.length} category/form-factor cell(s) below target on the live site`,
    );
  }
  return c.json({
    success: true,
    data: {
      stored: result.stored,
      rejected: result.rejected,
      ok: result.ok,
      scores,
      shortfalls: result.shortfalls.map((s) => ({ url: s.url, formFactor: s.formFactor, category: s.category, score: s.score, target: s.target, ownerOnly: s.ownerOnly, audits: s.audits.map((a) => a.id) })),
      alertsRaised: result.alertsRaised,
      alertsResolved: result.alertsResolved,
    },
  });
});

export default routes;
