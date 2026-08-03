import { describe, it, expect } from 'vitest';
import {
  decideWebhookVerification,
  graceEnabledFor,
} from '../../apps/api/src/domain/payments/WebhookVerificationPolicy';
import { RecordPaymentWebhookUseCase } from '../../apps/api/src/application/use-cases/payments/RecordPaymentWebhookUseCase';

/**
 * Grace mode exists so a deployment whose provider secrets are not yet
 * configured can keep taking callbacks while that is fixed. It must not become
 * a way to make unsigned traffic ordinarily acceptable.
 */

describe('the grace flag is off unless explicitly enabled', () => {
  it('is off by default', () => {
    expect(graceEnabledFor('mtn', {})).toBe(false);
  });

  it('is off for every ambiguous truthy string', () => {
    // A flag that disables payment authentication should never be switched on
    // by "1", "yes", or a typo.
    for (const value of ['1', 'yes', 'TRUE', 'on', 'True', '']) {
      expect(graceEnabledFor('mtn', { PAYMENT_WEBHOOK_UNVERIFIED_GRACE: value })).toBe(false);
    }
  });

  it('is on only for the exact string', () => {
    expect(graceEnabledFor('mtn', { PAYMENT_WEBHOOK_UNVERIFIED_GRACE: 'true' })).toBe(true);
  });

  it('can be enabled or disabled per provider', () => {
    expect(
      graceEnabledFor('mtn', {
        PAYMENT_WEBHOOK_UNVERIFIED_GRACE: 'true',
        PAYMENT_WEBHOOK_UNVERIFIED_GRACE_MTN: 'false',
      }),
    ).toBe(false);
    expect(graceEnabledFor('airtel', { PAYMENT_WEBHOOK_UNVERIFIED_GRACE_AIRTEL: 'true' })).toBe(true);
  });
});

describe('grace mode is narrow by construction', () => {
  it('accepts an authenticated webhook without review', () => {
    expect(decideWebhookVerification({
      signatureVerified: true, secretConfigured: true, graceEnabled: false,
    })).toEqual({ action: 'ACCEPT', requiresReview: false });
  });

  it('REJECTS a bad signature even with grace on', () => {
    // This is the limit that matters. A configured secret that did not match is
    // a wrong or forged signature, not a configuration gap. Without this, the
    // flag would disable signature checking entirely rather than bridge a gap.
    const decision = decideWebhookVerification({
      signatureVerified: false, secretConfigured: true, graceEnabled: true,
    });
    expect(decision.action).toBe('REJECT');
    if (decision.action === 'REJECT') expect(decision.reason).toBe('SIGNATURE_INVALID');
  });

  it('rejects an unconfigured provider when grace is off', () => {
    const decision = decideWebhookVerification({
      signatureVerified: false, secretConfigured: false, graceEnabled: false,
    });
    expect(decision.action).toBe('REJECT');
    if (decision.action === 'REJECT') expect(decision.reason).toBe('NOT_CONFIGURED');
  });

  it('accepts an unconfigured provider under grace, always flagged for review', () => {
    const decision = decideWebhookVerification({
      signatureVerified: false, secretConfigured: false, graceEnabled: true,
    });
    expect(decision.action).toBe('ACCEPT_UNVERIFIED');
    if (decision.action === 'ACCEPT_UNVERIFIED') expect(decision.requiresReview).toBe(true);
  });

  it('never produces an unflagged unverified acceptance', () => {
    // Exhaustive over the whole input space: eight combinations.
    for (const signatureVerified of [true, false]) {
      for (const secretConfigured of [true, false]) {
        for (const graceEnabled of [true, false]) {
          const d = decideWebhookVerification({ signatureVerified, secretConfigured, graceEnabled });
          if (!signatureVerified && d.action !== 'REJECT') {
            expect(d.requiresReview).toBe(true);
          }
        }
      }
    }
  });
});

describe('the use case honours the decision', () => {
  const repo = () => {
    const recorded: Record<string, unknown>[] = [];
    return {
      recorded,
      async findByIdempotencyKey() { return null; },
      async recordWebhookOutcome(input: Record<string, unknown>) {
        recorded.push(input);
        return { id: 'p1', orderId: String(input.orderId), status: 'SUCCESS' as const };
      },
    };
  };
  const base = {
    provider: 'mtn', orderId: 'o1', providerReference: 'r1',
    amount: 5000, outcome: 'SUCCESS' as const, idempotencyKey: 'k1',
  };
  const orders = { findTotalAmount: async () => 5000 };

  it('records nothing when the signature is wrong, grace or not', async () => {
    const r = repo();
    const out = await new RecordPaymentWebhookUseCase(r as never, orders).execute({
      ...base, signatureVerified: false, secretConfigured: true, graceEnabled: true,
    });
    expect(out.ok).toBe(false);
    expect(r.recorded).toHaveLength(0);
  });

  it('records with requiresReview under grace, and passes it to the repository', async () => {
    const r = repo();
    const out = await new RecordPaymentWebhookUseCase(r as never, orders).execute({
      ...base, signatureVerified: false, secretConfigured: false, graceEnabled: true,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.requiresReview).toBe(true);
    expect(r.recorded[0]).toMatchObject({ signatureVerified: false, requiresReview: true });
  });

  it('still verifies the amount for a grace-accepted payment', async () => {
    // An unauthenticated payload is not more trustworthy about its figures.
    const r = repo();
    const out = await new RecordPaymentWebhookUseCase(r as never, {
      findTotalAmount: async () => 9000,
    }).execute({ ...base, signatureVerified: false, secretConfigured: false, graceEnabled: true });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('AMOUNT_MISMATCH');
    expect(r.recorded).toHaveLength(0);
  });
});

describe('an unreviewed payment does not move the order', () => {
  const source = new URL(
    '../../apps/api/src/infrastructure/db/repositories/DrizzlePaymentRepository.ts',
    import.meta.url,
  );

  it('skips the order status update while review is pending', async () => {
    // Otherwise "held for manual review" is a phrase with nothing behind it:
    // the order would progress to fulfilment exactly as if payment were proven.
    const text = await (await import('node:fs/promises')).readFile(source, 'utf8');
    expect(text).toContain('if (!requiresReview) {');
    const guarded = text.slice(text.indexOf('if (!requiresReview) {'));
    // The order is moved ONLY inside the !requiresReview guard: a successful
    // payment transitions it through the canonical service; a failed one records
    // payment status. Both order-side writes live within this block.
    const block = guarded.slice(0, 900);
    expect(block).toContain('transitionWithin');
    expect(block).toContain('paymentStatus');
  });

  it('emits no PAYMENT_SUCCESS domain event while review is pending', async () => {
    const text = await (await import('node:fs/promises')).readFile(source, 'utf8');
    const eventIndex = text.indexOf('DOMAIN_EVENTS.PAYMENT_SUCCESS');
    const guardIndex = text.indexOf('if (requiresReview) return { row, outboxId };');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(eventIndex);
  });
});
