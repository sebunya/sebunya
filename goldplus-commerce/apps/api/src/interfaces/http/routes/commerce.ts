import { Hono } from 'hono';
import { z } from 'zod';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';
import { customerSessionMiddleware } from '../middleware/customerSession';
import { createHash } from 'crypto';
import { clientIp } from '../clientAddress';
import { mayProgressToPayment, mayCreateFulfilment } from '../../../domain/inventory/Inventory';

// Slice 3B: server-authoritative checkout input. Client prices/sku/names are
// deliberately absent — only productId + quantity are trusted; extra fields
// sent by older clients are stripped, never used.
const checkoutBodySchema = z.object({
  customerDetails: z.object({
    name: z.string().trim().min(1).max(255),
    email: z.string().trim().email().max(255).optional().or(z.literal('').transform(() => undefined)),
    phone: z.string().trim().min(5).max(20),
    deliveryArea: z.string().trim().min(1).max(255),
    deliveryAddress: z.string().trim().min(1).max(255),
    deliveryLocation: z
      .object({
        district: z.string().trim().min(1).max(100),
        region: z.string().trim().max(100).optional(),
        countyOrMunicipality: z.string().trim().max(150).optional(),
        subcountyDivisionTc: z.string().trim().max(150).optional(),
        parishWard: z.string().trim().max(150).optional(),
        postcode: z.string().trim().max(20).optional(),
        displayLabel: z.string().trim().max(255).optional(),
      })
      .nullish(),
  }),
  buyerType: z.enum(['retail', 'wholesale', 'corporate']),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(50),
  // REQUIRED. Without it a double-click, a browser retry or a flaky mobile
  // network creates a second real order, and nothing downstream can tell the
  // duplicate from a genuine second purchase.
  //
  // Deliberately not given a server-derived fallback: deriving one from the cart
  // contents would collapse a customer legitimately ordering the same basket
  // twice into a single order — an invisible loss of a real order. A missing key
  // is a visible, diagnosable 400 instead.
  clientOrderKey: z.string().trim().min(8).max(80),
  couponCode: z.string().trim().min(3).max(40).nullish(),
  previewQuoteId: z.string().uuid().nullish(),
  acceptPriceChange: z.boolean().optional(),
});

const routes = new Hono();
const registry = Registry.getInstance();

async function earnDormantLoyaltyForVerifiedOrder(orderId: string): Promise<void> {
  const source = await registry.orderRepo.findLoyaltyEarnSource(orderId);
  if (!source) return;
  const result = await registry.earnLoyaltyPointsUseCase.execute({
    userId: source.userId,
    orderId,
    orderTotalUgx: source.totalUgx,
  });
  if (!result.ok && result.code !== 'PROGRAMME_DISABLED') {
    throw new Error(`${result.code}: ${result.message}`);
  }
}

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
    const raw = await c.req.json().catch(() => null);
    const parsed = checkoutBodySchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const message = first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid checkout payload.';
      return c.json({ success: false, error: { code: 'INVALID_CHECKOUT', message } }, 400);
    }
    const body = parsed.data;
    const result = await registry.checkoutUseCase.execute({
      customerDetails: body.customerDetails,
      buyerType: body.buyerType,
      items: body.items,
      clientOrderKey: body.clientOrderKey,
      couponCode: body.couponCode ?? null,
      previewQuoteId: body.previewQuoteId ?? null,
      acceptPriceChange: body.acceptPriceChange ?? false,
    });

    // Section 12: reserve stock for the order (idempotent, all-or-nothing,
    // oversell-safe).
    //
    // Reservation is NOT best effort. The use case classifies the outcome
    // explicitly and records it on the order, so a technical failure is never
    // laundered into an ordinary backorder — which is what happened while every
    // exception here was caught and turned into ON_HOLD. Only a product whose
    // policy permits it can reach BACKORDERED; a stock-controlled line that
    // could not be held leaves the order UNRESERVED_BLOCKED.
    const reservation = await registry.reserveInventoryForOrderUseCase.execute(result.order);
    const backorderWarnings = reservation.warnings;
    const reservationState = reservation.state;
    const stockHeld = !reservation.fullyReserved;
    const mayProgress = mayProgressToPayment(reservationState);

    // Section 9.3: every successfully placed order creates exactly one idempotent
    // admin fulfilment alert (the internal "New Orders" work item). This never
    // depends on any external provider, so it works even when email/SMS/WhatsApp
    // are unavailable. The unique order_id constraint makes duplicate submissions
    // collapse to a single task.
    //
    // An order whose stock could not be confirmed gets NO fulfilment task at
    // all. Creating one — even ON_HOLD — puts unfulfillable work into the
    // operator's queue and asserts a stock position nobody established.
    if (mayCreateFulfilment(reservationState)) {
      try {
        await registry.createFulfilmentTaskOnOrderPlacedUseCase.execute(result.order, {
          extraWarnings: backorderWarnings,
          hold: stockHeld,
        });
      } catch (fulfilErr: any) {
        console.error('[API_ERROR] Fulfilment task creation failed (order persisted):', fulfilErr?.message);
      }
    }

    // Transactional admin order email intent (OrderPlaced). Idempotent, dry-run
    // (no provider call until activated); the order/fulfilment/notification all
    // remain available even if this enqueue fails.
    if (mayProgress) {
      try {
        await registry.enqueueAdminOrderEmailUseCase.execute({
          order: result.order,
          event: 'placed',
          stockConfirmed: !stockHeld,
        });
      } catch (emailErr: any) {
        console.error('[API_ERROR] Admin order email enqueue failed (order persisted):', emailErr?.message);
      }
    }

    // The order exists — it is never discarded, because discarding it would lose
    // the customer's intent — but it is reported truthfully as not proceeding,
    // and 409 rather than 200 so no client treats it as ready to pay.
    if (!mayProgress) {
      return c.json({
        success: false,
        error: {
          code: 'STOCK_NOT_RESERVED',
          message:
            'Your order was recorded but stock could not be confirmed, so it cannot be paid for yet. Our team will contact you.',
          details: {
            orderId: result.order.id,
            orderNumber: result.order.orderNumber,
            reservationState,
            reservationOutcome: reservation.code,
            warnings: backorderWarnings,
          },
        },
      }, 409);
    }

    const res: ApiResponse<any> = {
      success: true,
      data: {
        ...result.order,
        deliveryFeeConfirmed: result.deliveryFeeConfirmed,
        idempotentReplay: result.idempotentReplay,
        // Truthful stock outcome (Section 11): a held order is backordered and
        // is not ready for preparation until stock is confirmed.
        stockConfirmed: !stockHeld,
        reservationState,
        reservationOutcome: reservation.code,
        fulfilmentState: stockHeld ? 'ON_HOLD_BACKORDERED' : 'STOCK_CONFIRMED',
      },
    };
    return c.json(res);
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Order service is temporarily unavailable (Database is not configured).' } }, 503);
    }
    const known = ['PRODUCT_UNAVAILABLE', 'PRICE_UNAVAILABLE', 'PRICE_CHANGED', 'PROMOTION_CHANGED'].find((k) => err.message.startsWith(k));
    return c.json({ success: false, error: { code: known ?? 'ORDER_FAILED', message: err.message } }, 400);
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

    const ip = clientIp(c);

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

routes.post('/payments/pesapal/start', async (c) => {
  try {
    const body = await c.req.json();
    const orderId = String(body.orderId || '').trim();
    if (!orderId) {
      return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Missing orderId parameter.' } }, 400);
    }
    const result = await registry.startPesaPalPaymentUseCase.execute({ orderId });
    return c.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[API_ERROR] PesaPal start failed:', err);
    return c.json({ success: false, error: { code: 'PAYMENT_START_FAILED', message: err.message } }, 400);
  }
});

routes.get('/payments/pesapal/callback', async (c) => {
  const trackingId = c.req.query('OrderTrackingId') || c.req.query('orderTrackingId') || '';
  const reference = c.req.query('OrderMerchantReference') || c.req.query('orderMerchantReference') || '';
  
  const frontendCallbackUrl = process.env.PESAPAL_CALLBACK_URL || 'http://localhost:3000/checkout/pesapal/callback';

  if (!trackingId || !reference) {
    return c.redirect(`${frontendCallbackUrl}?status=failed&message=Missing+required+parameters`);
  }

  try {
    const result = await registry.verifyPesaPalPaymentUseCase.execute({
      orderTrackingId: trackingId,
      merchantReference: reference,
      source: 'callback'
    });

    if (result.ok && result.status === 'completed') {
      // Section 9.3: PaymentConfirmed updates the existing admin alert so the
      // order becomes ready for preparation. Idempotent — duplicate provider
      // callbacks never duplicate effects; a failure here never blocks the flow.
      try {
        await registry.markFulfilmentPaymentConfirmedUseCase.execute(result.orderId, 'paid');
      } catch (fulfilErr: any) {
        console.error('[API_ERROR] Fulfilment payment-confirmed update failed:', fulfilErr?.message);
      }
      try {
        await earnDormantLoyaltyForVerifiedOrder(result.orderId);
      } catch (loyaltyErr: any) {
        console.error('[API_ERROR] Loyalty paid-order earn failed:', loyaltyErr?.message);
      }
      // Transactional admin email (PaymentConfirmed). Idempotent per order.
      // Payment confirmation never clears an inventory hold: stockConfirmed is
      // derived from the fulfilment task's ON_HOLD state, not from payment.
      try {
        const paidOrder = await registry.orderRepo.findById(result.orderId);
        const task = await registry.getFulfilmentOverviewUseCase.byOrderId(result.orderId);
        if (paidOrder) {
          await registry.enqueueAdminOrderEmailUseCase.execute({
            order: paidOrder,
            event: 'payment-confirmed',
            stockConfirmed: task ? task.status !== 'ON_HOLD' : true,
          });
        }
      } catch (emailErr: any) {
        console.error('[API_ERROR] Admin payment-confirmed email enqueue failed:', emailErr?.message);
      }
      try {
        const order = await registry.orderRepo.findById(result.orderId);
        const mappedInput = registry.pesapalMeasurementMapper.map({
          verifiedPayment: result,
          trackingId,
          reference,
          customerEmail: order?.customerEmail,
          customerPhone: order?.customerPhone,
        });
        await registry.reconcilePesapalOrderMeasurementUseCase.execute(mappedInput);
      } catch (err: any) {
        console.error('[API_ERROR] Measurement reconciliation failed in callback:', err.message);
        try {
          await registry.paymentMeasurementRepo.createReconciliation({
            orderId: result.orderId || 'UNKNOWN',
            paymentReference: reference,
            pesapalTrackingId: trackingId,
            status: 'FAILED',
            amount: 0,
            currency: 'UGX'
          });
        } catch (subErr: any) {
          registry.measurementLogger.error({
            error: err.message,
            subError: subErr.message,
            orderId: result.orderId,
            trackingId,
            reference
          }, 'CRITICAL: Unable to record FAILED reconciliation in callback.');
        }
      }
    }
    
    if (result.ok && result.status === 'completed') {
      return c.redirect(`${frontendCallbackUrl}?status=success&trackingId=${encodeURIComponent(trackingId)}&reference=${encodeURIComponent(reference)}`);
    } else {
      return c.redirect(`${frontendCallbackUrl}?status=failed&trackingId=${encodeURIComponent(trackingId)}&reference=${encodeURIComponent(reference)}&message=${encodeURIComponent(result.message || 'Payment unresolved')}`);
    }
  } catch (err: any) {
    console.error('[API_ERROR] PesaPal callback failed:', err);
    return c.redirect(`${frontendCallbackUrl}?status=failed&message=${encodeURIComponent(err.message)}`);
  }
});

const handleIpn = async (c: any) => {
  let trackingId = '';
  let reference = '';
  let notificationType = '';

  trackingId = c.req.query('OrderTrackingId') || c.req.query('orderTrackingId') || '';
  reference = c.req.query('OrderMerchantReference') || c.req.query('orderMerchantReference') || '';
  notificationType = c.req.query('OrderNotificationType') || c.req.query('orderNotificationType') || '';

  if (c.req.method === 'POST') {
    try {
      const body = await c.req.json();
      trackingId = trackingId || body.OrderTrackingId || body.orderTrackingId || '';
      reference = reference || body.OrderMerchantReference || body.orderMerchantReference || '';
      notificationType = notificationType || body.OrderNotificationType || body.orderNotificationType || '';
    } catch {
      // Ignore body parsing issues
    }
  }

  if (!trackingId || !reference) {
    return c.json({ error: 'Missing required parameters' }, 400);
  }

  try {
    const result = await registry.verifyPesaPalPaymentUseCase.execute({
      orderTrackingId: trackingId,
      merchantReference: reference,
      source: 'ipn'
    });

    if (result.ok && result.status === 'completed') {
      // Section 9.3: PaymentConfirmed updates the existing admin alert so the
      // order becomes ready for preparation. Idempotent — duplicate provider
      // callbacks never duplicate effects; a failure here never blocks the flow.
      try {
        await registry.markFulfilmentPaymentConfirmedUseCase.execute(result.orderId, 'paid');
      } catch (fulfilErr: any) {
        console.error('[API_ERROR] Fulfilment payment-confirmed update failed:', fulfilErr?.message);
      }
      try {
        await earnDormantLoyaltyForVerifiedOrder(result.orderId);
      } catch (loyaltyErr: any) {
        console.error('[API_ERROR] Loyalty paid-order earn failed:', loyaltyErr?.message);
      }
      // Transactional admin email (PaymentConfirmed). Idempotent per order.
      // Payment confirmation never clears an inventory hold: stockConfirmed is
      // derived from the fulfilment task's ON_HOLD state, not from payment.
      try {
        const paidOrder = await registry.orderRepo.findById(result.orderId);
        const task = await registry.getFulfilmentOverviewUseCase.byOrderId(result.orderId);
        if (paidOrder) {
          await registry.enqueueAdminOrderEmailUseCase.execute({
            order: paidOrder,
            event: 'payment-confirmed',
            stockConfirmed: task ? task.status !== 'ON_HOLD' : true,
          });
        }
      } catch (emailErr: any) {
        console.error('[API_ERROR] Admin payment-confirmed email enqueue failed:', emailErr?.message);
      }
      try {
        const order = await registry.orderRepo.findById(result.orderId);
        const mappedInput = registry.pesapalMeasurementMapper.map({
          verifiedPayment: result,
          trackingId,
          reference,
          customerEmail: order?.customerEmail,
          customerPhone: order?.customerPhone,
        });
        await registry.reconcilePesapalOrderMeasurementUseCase.execute(mappedInput);
      } catch (err: any) {
        console.error('[API_ERROR] Measurement reconciliation failed in IPN:', err.message);
        try {
          await registry.paymentMeasurementRepo.createReconciliation({
            orderId: result.orderId || 'UNKNOWN',
            paymentReference: reference,
            pesapalTrackingId: trackingId,
            status: 'FAILED',
            amount: 0,
            currency: 'UGX'
          });
        } catch (subErr: any) {
          registry.measurementLogger.error({
            error: err.message,
            subError: subErr.message,
            orderId: result.orderId,
            trackingId,
            reference
          }, 'CRITICAL: Unable to record FAILED reconciliation in IPN.');
        }
      }
    }

    return c.json({
      orderNotificationType: notificationType || 'IPNCHANGE',
      orderTrackingId: trackingId,
      orderMerchantReference: reference,
      status: 200
    });
  } catch (err: any) {
    console.error('[API_ERROR] PesaPal IPN failed:', err);
    return c.json({ error: 'An internal error occurred.' }, 500);
  }
};

routes.post('/payments/pesapal/ipn', handleIpn);
routes.get('/payments/pesapal/ipn', handleIpn);

export default routes;
