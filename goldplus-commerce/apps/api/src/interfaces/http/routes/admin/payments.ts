import { Hono } from 'hono';
import { PERMISSIONS, ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';

/**
 * The ops payment queue (payments brief, 2026-08-06).
 *
 * OUR STATUS BESIDE THE PROVIDER'S, so a human can see disagreement. The whole
 * outage class this brief exists for — five attempts trapped in `pending` for
 * eleven weeks — was invisible precisely because nobody could see the two
 * columns next to each other.
 *
 * Guard strings from the PERMISSIONS vocabulary: reading is PAYMENTS_READ,
 * forcing a re-verification is PAYMENTS_CONFIRM (it can settle an order), and
 * refunding is PAYMENTS_REFUND — its own right, because giving money back is
 * neither reading nor confirming.
 */
// audit-exempt: the writes here are audited inside their use cases — refund in
// RefundPesaPalPaymentUseCase, settlement in the canonical order transition
// path. Auditing again at the route would double-log.
const routes = new Hono();
routes.use('*', authMiddleware);

/**
 * Every recent attempt with our status and, live, the provider's.
 *
 * The provider column is fetched per row and NEVER cached: the entire point is
 * to catch our record disagreeing with theirs, and a cached copy of our own
 * last impression is not their record.
 */
routes.get('/queue', requirePermissions([PERMISSIONS.PAYMENTS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const attempts = await registry.pesapalPaymentRepo.listRecent(50);
  const rows = await Promise.all(
    attempts.map(async (a) => {
      let provider: { status: string; code: number | null; method: string | null; confirmation: string | null } | null = null;
      let providerError: string | null = null;
      if (a.orderTrackingId) {
        try {
          const s = await registry.pesapalClient.getTransactionStatus(a.orderTrackingId);
          provider = {
            status: s.payment_status_description || 'UNKNOWN',
            code: Number.isFinite(s.status_code) ? s.status_code : null,
            method: s.payment_method ?? null,
            confirmation: s.confirmation_code ?? null,
          };
        } catch (e) {
          providerError = e instanceof Error ? e.message.slice(0, 120) : String(e);
        }
      }
      // Disagreement: the provider says COMPLETED and we do not, or vice versa.
      // That gap between the columns IS the outage, visible without a log.
      const providerSaysPaid = provider?.code === 1;
      const weSayPaid = a.status === 'completed';
      return {
        merchantReference: a.merchantReference,
        orderId: a.orderId,
        amountUgx: a.amount,
        ourStatus: a.status,
        provider,
        providerError,
        disagreement: a.orderTrackingId ? providerSaysPaid !== weSayPaid : false,
        ipnReceivedAt: a.ipnReceivedAt,
        callbackReceivedAt: a.callbackReceivedAt,
        createdAt: a.createdAt,
      };
    }),
  );
  const disagreements = rows.filter((r) => r.disagreement);
  return c.json({
    success: true,
    data: {
      rows,
      counts: { total: rows.length, disagreements: disagreements.length },
      note:
        rows.length === 0
          ? 'No payment attempt has ever been made. This queue fills with the first checkout that chooses online payment.'
          : disagreements.length > 0
            ? 'DISAGREEMENT: our record and the provider’s differ on at least one attempt. Re-verify it — if the provider says COMPLETED, a customer has paid and we have not honoured it.'
            : null,
    },
  });
});

/**
 * Force a re-verification through the SAME settlement path as the IPN.
 *
 * This is the human exit from verification_failed and the impatient exit from
 * pending — it cannot invent an outcome, only ask the provider again.
 */
routes.post('/attempts/:merchantReference/reverify', requirePermissions([PERMISSIONS.PAYMENTS_CONFIRM]), async (c) => {
  const registry = Registry.getInstance();
  const reference = String(c.req.param('merchantReference') ?? '');
  const attempt = await registry.pesapalPaymentRepo.findByMerchantReference(reference);
  if (!attempt) {
    return c.json({ success: false, error: { code: 'ATTEMPT_NOT_FOUND', message: 'No attempt matches that reference.' } } satisfies ApiResponse<never>, 404);
  }
  if (!attempt.orderTrackingId) {
    return c.json(
      { success: false, error: { code: 'NO_PROVIDER_TRANSACTION', message: 'This attempt never reached the provider — there is nothing to re-verify.' } } satisfies ApiResponse<never>,
      409,
    );
  }
  const result = await registry.settlePaymentUseCase.execute({
    orderTrackingId: attempt.orderTrackingId,
    merchantReference: reference,
    source: 'ops_reverify',
    traceId: `ops:${(c.get('user') as { id: string }).id}:${reference}`,
  });
  return c.json({
    success: true,
    data: {
      providerStatus: result.verification.status,
      settlement: result.settlement.kind,
      confirmed: result.confirmed,
    },
  });
});

/** Run the reconciliation sweep on demand rather than waiting for the ticker. */
routes.post('/reconcile/run', requirePermissions([PERMISSIONS.PAYMENTS_CONFIRM]), async (c) => {
  const result = await Registry.getInstance().reconcilePendingPaymentsUseCase.execute(new Date());
  return c.json({ success: true, data: result });
});

/**
 * Refund. Its own permission, fully audited, and honest about its state: no
 * completed payment has ever existed, so this path is UNEXERCISED AGAINST REAL
 * MONEY and proven synthetically only.
 */
routes.post('/attempts/:merchantReference/refund', requirePermissions([PERMISSIONS.PAYMENTS_REFUND]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const raw = Number(String(body?.amountUgx ?? '').replace(/[,\s]/g, ''));
  const user = c.get('user') as { id: string; email?: string };
  const result = await Registry.getInstance().refundPesaPalPaymentUseCase.execute({
    merchantReference: String(c.req.param('merchantReference') ?? ''),
    amountUgx: Number.isFinite(raw) ? raw : Number.NaN,
    reason: typeof body?.reason === 'string' ? body.reason : '',
    actorId: user.id,
    actorUsername: user.email ?? user.id,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: { providerStatus: result.providerStatus, providerMessage: result.providerMessage } });
});

/* ── Operational configuration (TTL, abandonment, health alert) ──────────── */

routes.get('/ops-config', requirePermissions([PERMISSIONS.PAYMENTS_READ]), async (c) => {
  const { PAYMENTS_OPS_CONFIG_REGISTRY } = await import('../../../../domain/payments/PaymentsOpsConfig');
  const values = await Registry.getInstance().paymentsOpsConfig.values();
  return c.json({
    success: true,
    data: {
      entries: PAYMENTS_OPS_CONFIG_REGISTRY.map((e) => ({
        ...e,
        value: values[e.key] ?? null,
        set: values[e.key] !== undefined,
      })),
      note: 'Every unset value means that mechanism is OFF. Nothing here shipped with a default.',
    },
  });
});

routes.put('/ops-config/:key', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = await Registry.getInstance().paymentsOpsConfig.set({
    key: String(c.req.param('key') ?? ''),
    value: String(body?.value ?? ''),
    actorId: (c.get('user') as { id: string }).id,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: 'INVALID_CONFIG', message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: { saved: true } });
});

export default routes;
