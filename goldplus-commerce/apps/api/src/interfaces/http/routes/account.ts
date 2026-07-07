import { Hono } from 'hono';
import { customerSessionMiddleware } from '../middleware/customerSession';
import { Registry } from '../../../infrastructure/Registry';
import { ListMyOrdersUseCase, GetMyOrderUseCase } from '../../../application/use-cases/orders/CustomerOrderUseCases';
import { ListMyAddressesUseCase, AddAddressUseCase } from '../../../application/use-cases/addresses/AddressUseCases';
import { GetLoyaltySummaryUseCase } from '../../../application/use-cases/loyalty/GetLoyaltySummaryUseCase';
import { CreateAuditLogUseCase } from '../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, MeDto, OrderSummaryDto, OrderDetailDto, AddressDto } from '@goldplus/shared';

const routes = new Hono<{ Variables: { userId: string; userEmail: string } }>();
routes.use('*', customerSessionMiddleware);

routes.get('/me', async (c) => {
  const userId = c.get('userId') as string;
  const user = await Registry.getInstance().userRepo.findById(userId);
  if (!user) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    return c.json(res, 404);
  }
  const me: MeDto = {
    id: user.id,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt.toISOString(),
  };
  const res: ApiResponse<MeDto> = { success: true, data: me };
  return c.json(res);
});

routes.get('/orders', async (c) => {
  const userId = c.get('userId') as string;
  const uc = new ListMyOrdersUseCase(Registry.getInstance().orderRepo);
  const data = await uc.execute(userId);
  const res: ApiResponse<OrderSummaryDto[]> = { success: true, data };
  return c.json(res);
});

routes.get('/orders/:id', async (c) => {
  const userId = c.get('userId') as string;
  const uc = new GetMyOrderUseCase(Registry.getInstance().orderRepo);
  const result = await uc.execute(c.req.param('id'), userId);
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'Order not found.' } };
    return c.json(res, 404);
  }
  const res: ApiResponse<OrderDetailDto> = { success: true, data: result.order };
  return c.json(res);
});

routes.post('/password', async (c) => {
  const userId = c.get('userId') as string;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const registry = Registry.getInstance();
  const result = await registry.changePasswordUseCase.execute({
    userId,
    currentPassword: String(body.currentPassword ?? ''),
    newPassword: String(body.newPassword ?? ''),
  });

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'WRONG_PASSWORD' ? 403 : 400;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: userId,
    action: 'PASSWORD_CHANGED',
    entity: 'user',
    entityId: userId,
  });

  const res: ApiResponse<{ status: string }> = { success: true, data: { status: 'password_changed' } };
  return c.json(res);
});

routes.get('/identities', async (c) => {
  const userId = c.get('userId') as string;
  const identities = await Registry.getInstance().userIdentityRepo.listForUser(userId);
  const data = identities.map((i) => ({ provider: i.provider, email: i.email, linkedAt: i.createdAt.toISOString() }));
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.delete('/identities/:provider', async (c) => {
  const userId = c.get('userId') as string;
  const provider = c.req.param('provider');
  const registry = Registry.getInstance();

  // Prevent lockout: an account created via social login has no usable
  // password (only a random placeholder hash), and password reset is not
  // yet available. Since we cannot distinguish a usable password from that
  // placeholder, conservatively refuse to remove the *last* connected
  // identity. Accounts with another linked identity can always unlink one.
  const identities = await registry.userIdentityRepo.listForUser(userId);
  if (identities.some((i) => i.provider === provider) && identities.length <= 1) {
    const res: ApiResponse<never> = {
      success: false,
      error: {
        code: 'LAST_LOGIN_METHOD',
        message: 'This is your only connected sign-in method, so it cannot be disconnected. Contact support if you need to change it.',
      },
    };
    return c.json(res, 409);
  }

  const removed = await registry.userIdentityRepo.unlink(userId, provider);
  if (!removed) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'No linked account for that provider.' } };
    return c.json(res, 404);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: userId,
    action: 'SOCIAL_IDENTITY_UNLINKED',
    entity: 'user',
    entityId: userId,
    newState: { provider },
  });

  const res: ApiResponse<{ status: string }> = { success: true, data: { status: 'unlinked' } };
  return c.json(res);
});

routes.get('/loyalty', async (c) => {
  const userId = c.get('userId') as string;
  const uc = new GetLoyaltySummaryUseCase(Registry.getInstance().loyaltyLedgerRepo);
  const data = await uc.execute(userId);
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.get('/addresses', async (c) => {
  const userId = c.get('userId') as string;
  const uc = new ListMyAddressesUseCase(Registry.getInstance().addressRepo);
  const data = await uc.execute(userId);
  const res: ApiResponse<AddressDto[]> = { success: true, data };
  return c.json(res);
});

routes.post('/addresses', async (c) => {
  const userId = c.get('userId') as string;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }
  const uc = new AddAddressUseCase(Registry.getInstance().addressRepo);
  const result = await uc.execute({
    userId,
    label: String(body.label ?? ''),
    recipientName: String(body.recipientName ?? ''),
    phone: String(body.phone ?? ''),
    district: String(body.district ?? ''),
    areaDetails: String(body.areaDetails ?? ''),
    makeDefault: Boolean(body.makeDefault),
  });
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, 400);
  }
  const res: ApiResponse<AddressDto> = { success: true, data: result.address };
  return c.json(res, 201);
});

export default routes;
