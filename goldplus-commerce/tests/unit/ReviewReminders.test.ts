import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SendReviewRemindersUseCase,
  REVIEW_REMINDER_AFTER_DAYS,
  REVIEW_REMINDER_UNTIL_DAYS,
} from '../../apps/api/src/application/use-cases/reviews/SendReviewRemindersUseCase';
import { customerMessageForTransition } from '../../apps/api/src/application/notifications/OrderLifecycleMessages';
import { smsText, emailCopy } from '../../apps/api/src/application/notifications/CustomerMessages';
import { classifyTemplate } from '../../apps/api/src/infrastructure/notifications/messageClassification';

const DAY = 86_400_000;

describe('the review ask reaches every closed order', () => {
  it('a delivery and a counter collection both carry the review link', () => {
    const delivered = customerMessageForTransition('delivered', 'administrator')!;
    const collected = customerMessageForTransition('completed', 'administrator')!;
    for (const t of [delivered, collected]) {
      expect(smsText(t, { orderNumber: 'GP-1' }), t).toContain('/review?reference=GP-1');
    }
    // "Delivered" is never said of a collection.
    expect(smsText(collected, { orderNumber: 'GP-1' })).not.toMatch(/deliver/i);
    expect(emailCopy(collected, { orderNumber: 'GP-1' })!.body).not.toMatch(/deliver/i);
  });

  it('the reminder says it is the only one, and is not held for marketing consent', () => {
    expect(smsText('ORDER_REVIEW_REMINDER', { orderNumber: 'GP-1' })).toMatch(/not ask again/);
    expect(emailCopy('ORDER_REVIEW_REMINDER', { orderNumber: 'GP-1' })!.body).toMatch(/only reminder/);
    expect(classifyTemplate('ORDER_REVIEW_REMINDER')).toBe('TRANSACTIONAL');
    expect(classifyTemplate('ORDER_COLLECTED')).toBe('TRANSACTIONAL');
  });
});

describe('SendReviewRemindersUseCase', () => {
  it('asks for orders closed between 4 and 14 days ago and sends each one', async () => {
    const asked: Array<{ closedBefore: Date; closedAfter: Date }> = [];
    const sent: string[] = [];
    const uc = new SendReviewRemindersUseCase(
      { findDue: async (i) => { asked.push(i); return ['a', 'b']; } },
      async (id) => { sent.push(id); },
    );
    const now = new Date('2026-10-19T12:00:00Z');
    const out = await uc.execute(now);
    expect(REVIEW_REMINDER_AFTER_DAYS).toBe(4);
    expect(REVIEW_REMINDER_UNTIL_DAYS).toBe(14);
    expect(asked[0].closedBefore.getTime()).toBe(now.getTime() - 4 * DAY);
    expect(asked[0].closedAfter.getTime()).toBe(now.getTime() - 14 * DAY);
    expect(sent).toEqual(['a', 'b']);
    expect(out).toEqual({ due: 2, enqueued: 2, failed: 0 });
  });

  it('one failed send does not stop the rest', async () => {
    const sent: string[] = [];
    const uc = new SendReviewRemindersUseCase(
      { findDue: async () => ['a', 'b', 'c'] },
      async (id) => { if (id === 'b') throw new Error('db'); sent.push(id); },
    );
    expect(await uc.execute(new Date('2026-10-19T09:00:00Z'))).toEqual({ due: 3, enqueued: 2, failed: 1 }); // noon Kampala
    expect(sent).toEqual(['a', 'c']);
  });

  it('the candidate query skips reviewed, reversed, open-complaint and already-reminded orders', () => {
    const src = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/reviews/DrizzleReviewReminderCandidates.ts'), 'utf8');
    expect(src).toMatch(/payment_status <> 'reversed'/);
    expect(src).toMatch(/from reviews r join order_items oi/);
    expect(src).toMatch(/from care_tasks t[\s\S]*t\.status = 'open'/);
    // Must match the key Registry.enqueueCustomerOrderMessage writes.
    expect(src).toContain(`'customer-order-message:' || o.id::text || ':ORDER_REVIEW_REMINDER'`);
    const registry = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/Registry.ts'), 'utf8');
    expect(registry).toContain('idempotencyKey: `customer-order-message:${orderId}:${template}`');
  });
});
