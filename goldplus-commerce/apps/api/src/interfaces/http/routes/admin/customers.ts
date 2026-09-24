import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { GetCustomerWorkspaceUseCase } from '../../../../application/use-cases/admin/GetCustomerWorkspaceUseCase';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Customer workspace (admin maturity pass, 2026-09-12): one customer's
 * account, orders, loyalty and support in a single read, assembled from the
 * existing readers. Gated by ORDERS_READ — the audience that already sees
 * these orders. Support tickets are included only for a caller who also holds
 * REPORTS_READ (the support inbox's own gate), and staff accounts are not
 * customers: their ids answer 404. Read-only.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/:userId', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const uc = new GetCustomerWorkspaceUseCase({
    users: { findById: (id) => registry.userRepo.findById(id) },
    orders: { listForUser: (id) => registry.orderRepo.listForUser(id) },
    loyalty: {
      findAccountByUserId: (id) => registry.loyaltyRepo.findAccountByUserId(id),
      listEntries: (accountId) => registry.loyaltyRepo.listEntries(accountId),
    },
    staff: { isStaff: async (id) => (await registry.roleRepo.findPermissionsForUser(id)).length > 0 },
    support: { execute: () => registry.getSupportInboxUseCase.execute() as never },
  });
  // Tickets only for a caller who may read the support inbox itself.
  const caller = c.get('user') as { permissions?: string[] } | undefined;
  const includeSupport = (caller?.permissions ?? []).includes(PERMISSIONS.REPORTS_READ);
  const data = await uc.execute(c.req.param('userId') ?? '', new Date(), { includeSupport });
  if (!data) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found.' } }, 404);
  return c.json({ success: true, data });
});

export default routes;
