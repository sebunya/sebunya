import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Registry } from '../../../infrastructure/Registry';
import { RecordPaymentWebhookUseCase } from '../../../application/use-cases/payments/RecordPaymentWebhookUseCase';
import { enqueuePurchaseEvent } from '../../../application/use-cases/telemetry/EnqueuePurchaseEventUseCase';
import { ApiResponse } from '@goldplus/shared';
import { logger } from '../../../infrastructure/logging/logger';
import { clientIp } from '../clientAddress';
import { graceEnabledFor } from '../../../domain/payments/WebhookVerificationPolicy';

const routes = new Hono();

const ALLOWED = new Set(['mtn', 'airtel']);

function envSecretFor(provider: string): string | undefined {
  if (provider === 'mtn') return process.env.MTN_WEBHOOK_SECRET;
  if (provider === 'airtel') return process.env.AIRTEL_WEBHOOK_SECRET;
  return undefined;
}

function verifySignature(rawBody: string, header: string | undefined, secret: string | undefined): boolean {
  if (!secret) return false;
  if (!header) return false;
  try {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(header.trim().toLowerCase(), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

routes.post('/payment/:provider', async (c) => {
  const provider = c.req.param('provider').toLowerCase();
  if (!ALLOWED.has(provider)) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'UNKNOWN_PROVIDER', message: `Provider "${provider}" is not enabled.` },
    };
    return c.json(res, 404);
  }

  const rawBody = await c.req.text();
  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'BAD_JSON', message: 'Request body must be JSON.' },
    };
    return c.json(res, 400);
  }

  const signatureHeader = c.req.header('x-goldplus-signature');
  const secret = envSecretFor(provider);
  const signatureVerified = verifySignature(rawBody, signatureHeader, secret);
  const secretConfigured = !!secret;

  // Verify the provider-reported amount against the order total. The signature
  // proves who sent the payload, not that the figure in it is correct.
  const registry = Registry.getInstance();
  const useCase = new RecordPaymentWebhookUseCase(registry.paymentRepo, {
    findTotalAmount: async (orderId: string) => {
      const order = await registry.orderRepo.findById(orderId);
      return order ? order.totalUgx : null;
    },
  });

  // Implementation Safety Update: Encapsulating useCase.execute inside try-catch
  // to correctly capture DB/Entity throws and translate to 422 responses.
  try {
    const result = await useCase.execute({
      provider,
      orderId: String(parsed.orderId ?? '').trim(),
      providerReference: parsed.providerReference ? String(parsed.providerReference) : null,
      amount: Number(parsed.amount),
      outcome: String(parsed.outcome ?? '').toUpperCase() as 'SUCCESS' | 'FAILED',
      idempotencyKey: c.req.header('idempotency-key') ?? (parsed.idempotencyKey as string | undefined) ?? null,
      signatureVerified,
      secretConfigured,
      graceEnabled: graceEnabledFor(provider, process.env),
    });

    if (!result.ok) {
      if (result.code === 'SIGNATURE_INVALID') {
        // Recorded so a burst of forged webhooks is visible. No body content is
        // logged: it is attacker-controlled and may carry anything.
        logger.warn(
          { provider, secretConfigured, hasSignatureHeader: !!signatureHeader },
          'PAYMENT_WEBHOOK_SIGNATURE_REJECTED',
        );
        return c.json({
          success: false,
          error: {
            code: secretConfigured ? 'SIGNATURE_INVALID' : 'NOT_CONFIGURED',
            message: secretConfigured
              ? 'Webhook signature could not be verified.'
              : 'Not configured: webhook signature secret is missing for this provider.',
          },
        }, secretConfigured ? 401 : 503);
      }
      const statusCode = result.code === 'MISSING_ORDER' ? 422 : 400;
      const res: ApiResponse<never> = {
        success: false,
        error: { code: result.code, message: result.message },
        meta: { signatureVerified, secretConfigured },
      };
      return c.json(res, statusCode);
    }

    const res: ApiResponse<{
      paymentId: string;
      orderId: string;
      status: 'SUCCESS' | 'FAILED';
      replay: boolean;
    }> = {
      success: true,
      data: {
        paymentId: result.payment.id,
        orderId: result.payment.orderId,
        status: result.payment.status,
        replay: result.replay,
      },
      meta: {
        signatureVerified,
        secretConfigured,
        warning: secretConfigured ? undefined : 'Not configured: webhook signature secret missing for this provider.',
      },
    };

    if (result.requiresReview) {
      // Loud, and at error level: an unauthenticated payment is sitting in the
      // finance queue and an order is stalled behind it until a human acts.
      logger.error(
        { provider, orderId: result.payment.orderId, paymentId: result.payment.id },
        'PAYMENT_WEBHOOK_UNVERIFIED_ACCEPTED_PENDING_REVIEW',
      );
      res.meta = { ...res.meta, requiresReview: true };
    }

    // ─── Enqueue server-side purchase event on first confirmed SUCCESS ────────
    // "Confirmed" excludes a payment held for review: it has not been
    // authenticated, so treating it as a purchase would report revenue that
    // nobody has established happened.
    if (result.payment.status === 'SUCCESS' && !result.replay && !result.requiresReview) {
      enqueuePurchaseEvent({
        orderId: result.payment.orderId,
        transactionId: result.payment.providerReference || result.payment.id,
        value: Number(parsed.amount) || 0,
        currency: 'UGX',
        // Attempt to extract client context forwarded by the provider webhook
        ipAddress: clientIp(c),
        traceId: c.req.header('x-request-id'),
      }).then(async (outboxId) => {
        if (outboxId) {
          const { QueueService, QUEUES } = await import('../../../infrastructure/queues/QueueService');
          await QueueService.getInstance().enqueue(
            QUEUES.TELEMETRY_DISPATCH,
            `purchase-dispatch:${result.payment.orderId}`,
            { outboxId },
            outboxId
          );
        }
      }).catch(err => logger.error({ err, orderId: result.payment.orderId }, '[Webhook] Failed to enqueue purchase telemetry event'));
    }

    return c.json(res, 200);

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('MISSING_ORDER')) {
      const res: ApiResponse<never> = {
        success: false,
        error: { code: 'MISSING_ORDER', message },
        meta: { signatureVerified, secretConfigured },
      };
      return c.json(res, 422);
    }
    throw err; // Escalate real 500s (like syntax or database system failure)
  }
});

export default routes;
