import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Registry } from '../../../infrastructure/Registry';
import { RecordPaymentWebhookUseCase } from '../../../application/use-cases/payments/RecordPaymentWebhookUseCase';
import { ApiResponse } from '@goldplus/shared';

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

  const useCase = new RecordPaymentWebhookUseCase(Registry.getInstance().paymentRepo);

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
    });

    if (!result.ok) {
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
