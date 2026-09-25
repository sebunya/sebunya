import { Hono } from 'hono';
import { z } from 'zod';
import { PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { logger } from '../../../../infrastructure/logging/logger';
import { csvCell } from '../../csv';
import { channelReportCsvRows, parseReportModel } from '../../../../domain/measurement/ChannelReport';

/**
 * Attribution module (docs/measurement/ATTRIBUTION.md, migration 0156):
 *   GET  /channel-report[.csv]   weekly channel × orders, revenue, spend, ROAS, cost per order
 *   POST /recompute              recompute every order's credit for a window (audited)
 *   GET  /orders/:orderId        one order's touches, answers and credits
 *   POST /orders/:orderId/source staff record "how they heard" / the WhatsApp reference (audited)
 * Thin: every rule lives in the use cases and the domain.
 */
const routes = new Hono();
const registry = Registry.getInstance();
routes.use('*', authMiddleware);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const weeksOf = (v: string | undefined) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 52 ? n : 12; };
const actorOf = (c: any): string => String(c.get('user')?.id ?? c.get('userId') ?? 'unknown');

routes.get('/channel-report', requirePermissions([PERMISSIONS.ATTRIBUTION_READ]), async (c) => {
  try {
    const data = await registry.channelAttribution.weeklyReport.execute({ model: parseReportModel(c.req.query('model')), weeks: weeksOf(c.req.query('weeks')) });
    return c.json({ success: true, data });
  } catch (err) {
    logger.error({ err }, '[Attribution] channel report failed');
    return c.json({ success: false, error: { code: 'REPORT_UNAVAILABLE', message: 'The channel report could not be read.' } }, 503);
  }
});

routes.get('/channel-report.csv', requirePermissions([PERMISSIONS.ATTRIBUTION_READ]), async (c) => {
  try {
    const model = parseReportModel(c.req.query('model'));
    const report = await registry.channelAttribution.weeklyReport.execute({ model, weeks: weeksOf(c.req.query('weeks')) });
    const lines = channelReportCsvRows(report).map((row) => row.map(csvCell).join(','));
    return new Response(`${lines.join('\r\n')}\r\n`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="channel-report-${model}-${report.weeks[report.weeks.length - 1]}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    logger.error({ err }, '[Attribution] channel report CSV failed');
    return c.json({ success: false, error: { code: 'REPORT_UNAVAILABLE', message: 'The channel report could not be read.' } }, 503);
  }
});

const recomputeSchema = z.object({ reason: z.string().trim().min(5).max(300), days: z.number().int().min(1).max(400).optional() });

routes.post('/recompute', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const parsed = recomputeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'A reason of at least 5 characters is required.' } }, 400);
  const actorId = actorOf(c);
  const result = await registry.channelAttribution.backfill.execute({ days: parsed.data.days ?? 120 });
  await registry.createAuditLogUseCase.execute({
    actorId: UUID.test(actorId) ? actorId : null, action: 'ATTRIBUTION_RECOMPUTED', entity: 'attribution', entityId: 'order_channel_credit',
    newState: { reason: parsed.data.reason, ...result },
  }).catch((err: unknown) => logger.error({ err }, '[Attribution] audit write failed'));
  return c.json({ success: true, data: result });
});

routes.get('/orders/:orderId', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const orderId = c.req.param('orderId') ?? '';
  if (!UUID.test(orderId)) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found.' } }, 404);
  const view = await registry.channelAttribution.orderView.execute(orderId);
  if (!view) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found.' } }, 404);
  return c.json({ success: true, data: view });
});

const sourceSchema = z.object({
  answer: z.string().max(40).optional(),
  whatsappRef: z.string().max(40).optional(),
  note: z.string().max(300).optional(),
});

routes.post('/orders/:orderId/source', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const orderId = c.req.param('orderId') ?? '';
  if (!UUID.test(orderId)) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found.' } }, 404);
  const parsed = sourceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }, 400);
  const actorId = actorOf(c);
  const r = await registry.channelAttribution.recordOrderSource.execute({ orderId, ...parsed.data, actorId });
  if (!r.ok) return c.json({ success: false, error: { code: r.code, message: r.message } }, r.code === 'ORDER_NOT_FOUND' ? 404 : 400);
  await registry.createAuditLogUseCase.execute({
    actorId: UUID.test(actorId) ? actorId : null, action: 'ORDER_SOURCE_RECORDED', entity: 'order', entityId: orderId,
    newState: { answer: parsed.data.answer ?? null, whatsappRef: r.whatsappRef, linkedTouches: r.linkedTouches },
  }).catch((err: unknown) => logger.error({ err, orderId }, '[Attribution] audit write failed'));
  return c.json({ success: true, data: r });
});

export default routes;
