import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';
import { customerSessionMiddleware } from '../middleware/customerSession';
import { createHash } from 'crypto';

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

routes.post('/cart/update', async (c) => {
  const body = await c.req.json();
  const { cartId, productId, quantity } = body;
  const cart = await registry.cartRepo.findById(cartId);
  if (cart) {
    const updated = cart.updateQuantity(productId, quantity);
    await registry.cartRepo.save(updated);
  }
  const res: ApiResponse<{ status: string }> = {
    success: true,
    data: { status: 'item_updated' },
  };
  return c.json(res);
});

routes.post('/cart/remove', async (c) => {
  const body = await c.req.json();
  const { cartId, productId } = body;
  const cart = await registry.cartRepo.findById(cartId);
  if (cart) {
    const updated = cart.removeItem(productId);
    await registry.cartRepo.save(updated);
  }
  const res: ApiResponse<{ status: string }> = {
    success: true,
    data: { status: 'item_removed' },
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

const maskPhone = (phone: string | null | undefined) => {
  if (!phone) return '*****';
  if (phone.length <= 5) return '*****';
  return phone.slice(0, 3) + '****' + phone.slice(-3);
};

const maskEmail = (email: string | null | undefined) => {
  if (!email) return '*****';
  const parts = email.split('@');
  if (parts.length !== 2) return '*****';
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) return '*@' + domain;
  return name.slice(0, 1) + '***' + name.slice(-1) + '@' + domain;
};

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const failedAttemptsLimiter = new Map<string, RateLimitEntry>();

routes.post('/orders/lookup', async (c) => {
  try {
    const body = await c.req.json();
    const rawRef = body.reference;
    const rawContact = body.contact;

    // Strict type safety: reject non-string inputs immediately to prevent malformed payload abuse
    if (typeof rawRef !== 'string' || typeof rawContact !== 'string') {
      return c.json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'We could not verify that order. Please check your reference and contact details.'
        }
      }, 400);
    }

    const reference = rawRef.trim();
    const contact = rawContact.trim();

    // Enforce size limits and non-empty checks
    if (!reference || !contact || reference.length > 80 || contact.length > 120) {
      return c.json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'We could not verify that order. Please check your reference and contact details.'
        }
      }, 400);
    }

    // Direct block of GP-DRAFT lookups to avoid hitting the database
    if (reference.toUpperCase().startsWith('GP-DRAFT-')) {
      return c.json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'We could not verify that order. Please check your reference and contact details.'
        }
      }, 400);
    }

    const ipHeader = c.req.header('x-forwarded-for');
    const ip = ipHeader ? ipHeader.split(',')[0].trim() : (c.req.header('x-real-ip') || '127.0.0.1');

    // Create safe anonymous fingerprint using SHA-256 (no raw credentials stored in keys)
    const fingerprint = createHash('sha256')
      .update(`${ip}-${reference.toUpperCase()}`)
      .digest('hex');

    const now = Date.now();
    const limitWindowMs = 10 * 60 * 1000; // 10 minutes
    const maxFailedAttempts = 5;

    // Self-cleaning Map inline to prevent memory growth
    for (const [key, val] of failedAttemptsLimiter.entries()) {
      if (val.resetTime <= now) {
        failedAttemptsLimiter.delete(key);
      }
    }

    // Rate Limiter Enforcement
    const record = failedAttemptsLimiter.get(fingerprint);
    if (record && record.resetTime > now) {
      if (record.count >= maxFailedAttempts) {
        return c.json({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many lookup attempts. Please wait a few minutes and try again.'
          }
        }, 429);
      }
    }

    const registerFailure = () => {
      const current = failedAttemptsLimiter.get(fingerprint);
      if (current && current.resetTime > now) {
        current.count += 1;
      } else {
        failedAttemptsLimiter.set(fingerprint, {
          count: 1,
          resetTime: now + limitWindowMs,
        });
      }
    };

    const order = await registry.getOrderByIdUseCase.execute(reference);
    if (!order) {
      registerFailure();
      return c.json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'We could not verify that order. Please check your reference and contact details.'
        }
      }, 401);
    }

    const normalizedContact = contact.toLowerCase();
    const storedEmail = (order.customerEmail ?? '').trim().toLowerCase();
    const storedPhone = (order.customerPhone ?? '').trim();

    const contactMatch =
      (storedEmail && normalizedContact === storedEmail) ||
      (storedPhone && normalizedContact.replace(/\s+/g, '') === storedPhone.replace(/\s+/g, ''));

    if (!contactMatch) {
      registerFailure();
      return c.json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'We could not verify that order. Please check your reference and contact details.'
        }
      }, 401);
    }

    // Clean rate limit tracking on success
    failedAttemptsLimiter.delete(fingerprint);

    // Minimize public response fields to prevent unnecessary database UUIDs or coordinates from leaking
    const maskedOrder = {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerPhone: maskPhone(order.customerPhone),
      customerEmail: order.customerEmail ? maskEmail(order.customerEmail) : undefined,
      deliveryArea: order.deliveryArea,
      items: order.items,
      subtotalUgx: order.subtotalUgx,
      deliveryFeeUgx: order.deliveryFeeUgx,
      totalUgx: order.totalUgx,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      createdAt: order.createdAt,
    };

    const res: ApiResponse<any> = {
      success: true,
      data: maskedOrder,
    };
    return c.json(res);
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL') || err.message.includes('relation "orders" does not exist')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database not configured yet' } }, 503);
    }
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.' } }, 500);
  }
});

routes.get('/orders/:id', customerSessionMiddleware, async (c) => {
  try {
    const id = c.req.param('id') || '';
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
