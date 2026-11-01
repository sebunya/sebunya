import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { Registry } from '../../../../infrastructure/Registry';
import { logger } from '../../../../infrastructure/logging/logger';

/**
 * Bank of Uganda rate ingest (2026-10-24). The 1 pm job (.github/workflows/bou-fx.yml running scripts/bou-fx.mjs)
 * reads the day's USD/UGX mid, buying and selling rates off bou.or.ug and posts them here. Machine-to-machine:
 * BOU_FX_TOKEN compared in constant time; no token configured means 503, never an anonymous write.
 */
const routes = new Hono();

function tokenMatches(presented: string | undefined): boolean {
  const expected = (process.env.BOU_FX_TOKEN ?? '').trim();
  if (expected.length < 32 || !presented) return false;
  const a = Buffer.from(presented), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

routes.post('/bou', async (c) => {
  if ((process.env.BOU_FX_TOKEN ?? '').trim().length < 32) return c.json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'BOU_FX_TOKEN is not set (32+ characters).' } }, 503);
  if (!tokenMatches(c.req.header('x-bou-fx-token'))) return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Bad token.' } }, 401);
  const body = await c.req.json().catch(() => null) as { day?: unknown; mid?: unknown; buying?: unknown; selling?: unknown; source?: unknown } | null;
  const r = await Registry.getInstance().recordBouFxReadingUseCase.execute({ day: String(body?.day ?? ''), mid: Number(body?.mid), buying: body?.buying as number | null | undefined, selling: body?.selling as number | null | undefined, source: body?.source ? String(body.source) : undefined });
  if (!r.ok) return c.json({ success: false, error: { code: 'BAD_INPUT', message: r.message } }, 400);
  logger.info({ day: r.day, mid: r.mid }, '[bou-fx] reading recorded');
  return c.json({ success: true, data: r });
});

export default routes;
