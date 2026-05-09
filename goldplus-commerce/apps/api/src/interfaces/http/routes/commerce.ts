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

routes.post('/checkout', async (c) => {
  const body = await c.req.json();
  const order = await registry.checkoutUseCase.execute({
    cartId: body.cartId,
    customerId: body.customerId || 'guest',
    customerDetails: body.customerDetails,
  });
  
  const res: ApiResponse<any> = {
    success: true,
    data: order,
  };
  return c.json(res);
});

export default routes;
