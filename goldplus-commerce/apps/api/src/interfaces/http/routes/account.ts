import { Hono } from 'hono';
import { customerSessionMiddleware } from '../middleware/customerSession';
import { Registry } from '../../../infrastructure/Registry';
import { ListMyOrdersUseCase, GetMyOrderUseCase } from '../../../application/use-cases/orders/CustomerOrderUseCases';
import { ListMyAddressesUseCase, AddAddressUseCase } from '../../../application/use-cases/addresses/AddressUseCases';
import { ApiResponse, MeDto, OrderSummaryDto, OrderDetailDto, AddressDto } from '@goldplus/shared';
import { clientIp } from '../clientAddress';

const routes = new Hono<{ Variables: { userId: string; userEmail: string } }>();
routes.use('*', customerSessionMiddleware);

// Slice 8: loyalty history — truthful: programmeActive stays false until the
// operator-approved activation; entries exist only from real orders/adjustments.
routes.get('/loyalty', async (c) => {
  const userId = c.get('userId') as string;
  const data = await Registry.getInstance().getLoyaltyHistoryUseCase.execute({ userId });
  return c.json({ success: true, data });
});

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

routes.get('/preferences', async (c) => {
  const userId = c.get('userId') as string;
  const uc = Registry.getInstance().getCustomerPreferenceCentreUseCase;
  const data = await uc.execute(userId);
  const res: ApiResponse<any> = { success: true, data };
  return c.json(res);
});

routes.put('/preferences', async (c) => {
  const userId = c.get('userId') as string;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }
  
  const uc = Registry.getInstance().updateCustomerPreferenceCentreUseCase;
  const data = await uc.execute({
    userId,
    ...body,
    ipAddress: clientIp(c),
    userAgent: c.req.header('user-agent') || 'unknown'
  });
  const res: ApiResponse<any> = { success: true, data };
  return c.json(res);
});

routes.get('/preferences/audit', async (c) => {
  const userId = c.get('userId') as string;
  const uc = Registry.getInstance().getPreferenceAuditTrailUseCase;
  const data = await uc.execute(userId);
  const res: ApiResponse<any> = { success: true, data };
  return c.json(res);
});

export default routes;
