import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import type { OrderStatus } from '../../../../domain/commerce/Order';

/**
 * Order lifecycle actions (Wave 2E-2).
 *
 * The canonical OrderTransitionService (advisory-locked, state-machine-validated,
 * order_events ledger) existed with no admin transport — operators could not move an
 * order at all. This is that transport and nothing more: identity from the session,
 * a mandatory human reason, the machine's own refusal surfaced verbatim (an illegal
 * move or an unpaid order answers 409 with the real cause, never a generic error).
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = <T>(c: any, data: T) => c.json({ success: true, data } satisfies ApiResponse<T>);
const bad = (c: any, code: string, message: string, status = 400) =>
  c.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, status);
const actor = (c: any): string => (c.get('user') as { id: string }).id;

const KNOWN_STATUSES: OrderStatus[] = [
  'received',
  'pending_payment',
  'pending_owner_review',
  'processing',
  'completed',
  'cancelled',
  'failed',
];

routes.post('/:id/transition', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const orderId = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  const toStatus = body?.toStatus as OrderStatus | undefined;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!toStatus || !KNOWN_STATUSES.includes(toStatus)) {
    return bad(c, 'BAD_INPUT', `toStatus must be one of: ${KNOWN_STATUSES.join(', ')}`);
  }
  if (!reason) return bad(c, 'BAD_INPUT', 'A reason is required for every order transition.');

  const registry = Registry.getInstance();
  // A refused move throws a client-safe DomainError (ORDER_TRANSITION_ILLEGAL_TRANSITION /
  // _UNPAID) which the app's global error mapping turns into the accurate 409/403 —
  // the machine's own words reach the operator, never a generic failure.
  const result = await registry.orderTransitionService.transition(orderId, toStatus, {
    actorId: actor(c),
    actorType: 'administrator',
    source: 'admin_api',
    reasonCode: 'ADMIN_ACTION',
    note: reason,
  });

  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actor(c),
    action: 'ORDER_TRANSITIONED',
    entity: 'order',
    entityId: orderId,
    previousState: { status: result.fromStatus },
    newState: { status: result.toStatus, reason, idempotentReplay: result.idempotentReplay },
  });
  return ok(c, result);
});

routes.post('/:id/note', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const orderId = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  if (!note) return bad(c, 'BAD_INPUT', 'A non-empty note is required.');
  const registry = Registry.getInstance();
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actor(c),
    action: 'ORDER_NOTE_ADDED',
    entity: 'order',
    entityId: orderId,
    newState: { note },
  });
  return ok(c, { orderId, noted: true });
});

export default routes;
