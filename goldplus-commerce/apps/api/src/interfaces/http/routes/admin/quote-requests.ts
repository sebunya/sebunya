import { Hono } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { csvCell } from '../../csv';
import { QUOTE_LINES_CSV_HEADER, quoteLinesCsvRows } from '../../../../application/use-cases/quotes/BulkQuoteUseCases';

/**
 * Quote requests for the sales team (docs/bulk-buying/DESIGN.md): every
 * request with its lines, one request, a CSV of every line, and the status
 * move. The same `quotes.manage` permission that guarded /governance/admin/quotes.
 */
const routes = new Hono();
const registry = Registry.getInstance();

routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.QUOTES_MANAGE]), async (c) => {
  const views = await registry.listQuoteRequestsUseCase.execute();
  return c.json({ success: true, data: views });
});

// Static path before /:id.
routes.get('/lines.csv', requirePermissions([PERMISSIONS.QUOTES_MANAGE]), async (c) => {
  const views = await registry.listQuoteRequestsUseCase.execute();
  const lines = [QUOTE_LINES_CSV_HEADER.join(','), ...quoteLinesCsvRows(views).map((row) => row.map(csvCell).join(','))];
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`${lines.join('\r\n')}\r\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="quote-request-lines-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

routes.get('/:id', requirePermissions([PERMISSIONS.QUOTES_MANAGE]), async (c) => {
  const view = await registry.getQuoteRequestUseCase.execute(c.req.param('id') ?? '');
  if (!view) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Quote request not found.' } }, 404);
  return c.json({ success: true, data: view });
});

routes.patch('/:id/status', requirePermissions([PERMISSIONS.QUOTES_MANAGE]), async (c) => {
  const body = (await c.req.json().catch(() => null)) as { status?: unknown } | null;
  const result = await registry.updateQuoteRequestStatusUseCase.execute({ id: c.req.param('id') ?? '', status: body?.status });
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'CONFLICT' ? 409 : 400;
    return c.json({ success: false, error: { code: result.code, message: result.message } }, status);
  }
  await registry.createAuditLogUseCase.execute({
    actorId: (c.get('user') as { id: string }).id,
    action: 'QUOTE_REQUEST_STATUS_CHANGED',
    entity: 'quote',
    entityId: result.id,
    previousState: { status: result.from },
    newState: { status: result.to },
  });
  return c.json({ success: true, data: { id: result.id, status: result.to } });
});

export default routes;
