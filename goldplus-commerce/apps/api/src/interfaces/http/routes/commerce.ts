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

routes.get('/carts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    
    // Validate UUID format before querying to prevent Postgres database syntax exceptions
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRegex.test(id)) {
      const errRes: ApiResponse<never> = {
        success: false,
        error: { code: 'INVALID_UUID', message: 'Invalid cart session identifier format.' }
      };
      return c.json(errRes, 400);
    }

    const cartData = await registry.getCartByIdUseCase.execute(id);

    const res: ApiResponse<any> = {
      success: true,
      data: cartData,
    };
    return c.json(res);
  } catch (err: any) {
    console.error('[API_ERROR] Failed to fetch cart data:', err);
    const errRes: ApiResponse<never> = {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    };
    return c.json(errRes, 500);
  }
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

routes.get('/orders/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const order = await registry.getOrderByIdUseCase.execute(id);
    
    if (!order) {
      return c.json({ success: false, error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' } }, 404);
    }

    const res: ApiResponse<any> = {
      success: true,
      data: order,
    };
    return c.json(res);
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL') || err.message.includes('relation "orders" does not exist')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured yet' } }, 503);
    }
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
  }
});

export default routes;
