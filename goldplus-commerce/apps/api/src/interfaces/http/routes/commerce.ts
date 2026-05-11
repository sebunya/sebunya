import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';

const routes = new Hono();
const registry = Registry.getInstance();

routes.post('/cart/add', async (c) => {
  const body = await c.req.json();
  await registry.addToCartUseCase.execute(body.cartId, body.item);
  
  const res: ApiResponse<{ status: string }> = {
    success: true,
    data: { status: 'item_added' },
  };
  return c.json(res);
});

routes.post('/orders/create', async (c) => {
  try {
    const body = await c.req.json();
    const order = await registry.checkoutUseCase.execute({
      customerDetails: body.customerDetails,
      buyerType: body.buyerType,
      items: body.items,
    });
    
    const res: ApiResponse<any> = {
      success: true,
      data: order,
    };
    return c.json(res);
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Order service is temporarily unavailable (Database is not configured).' } }, 503);
    }
    return c.json({ success: false, error: { code: 'ORDER_FAILED', message: err.message } }, 400);
  }
});

export default routes;
