import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_REMINDER_AFTER_MINUTES,
  PAYMENT_REMINDER_UNTIL_HOURS,
  SendUnpaidOrderRemindersUseCase,
} from '../../apps/api/src/application/use-cases/commerce/SendUnpaidOrderRemindersUseCase';
import { emailCopy, smsText, CUSTOMER_TRANSACTIONAL_TEMPLATES } from '../../apps/api/src/application/notifications/CustomerMessages';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('unpaid order reminder', () => {
  it('asks for orders placed between one hour and one day ago, and sends one each', async () => {
    const now = new Date('2026-10-20T12:00:00Z');
    let asked: any = null;
    const sent: string[] = [];
    const uc = new SendUnpaidOrderRemindersUseCase(
      { findDue: async (i) => { asked = i; return ['o1', 'o2']; } },
      async (id) => { sent.push(id); },
    );
    expect(await uc.execute(now)).toEqual({ due: 2, enqueued: 2, failed: 0 });
    expect(sent).toEqual(['o1', 'o2']);
    expect(asked.placedBefore.toISOString()).toBe(new Date(now.getTime() - PAYMENT_REMINDER_AFTER_MINUTES * 60_000).toISOString());
    expect(asked.placedAfter.toISOString()).toBe(new Date(now.getTime() - PAYMENT_REMINDER_UNTIL_HOURS * 3_600_000).toISOString());
  });

  it('ORDER_PAYMENT_REMINDERS=off stops it without asking the database', async () => {
    let called = false;
    const uc = new SendUnpaidOrderRemindersUseCase({ findDue: async () => { called = true; return []; } }, async () => undefined, () => false);
    expect(await uc.execute(new Date())).toMatchObject({ disabled: true, due: 0 });
    expect(called).toBe(false);
    expect(read('apps/api/src/infrastructure/Registry.ts')).toContain("process.env.ORDER_PAYMENT_REMINDERS || '').trim().toLowerCase() !== 'off'");
  });

  it('says how to pay, warns against paying twice, and promises no more reminders', () => {
    const d = { orderNumber: 'GP-202610-ABC', totalUgx: 45_000 } as never;
    const sms = smsText('ORDER_PAYMENT_REMINDER', d)!;
    expect(sms).toContain('GP-202610-ABC');
    expect(sms).toContain('45,000');
    expect(sms).toContain('/track-order?reference=GP-202610-ABC');
    expect(sms).toMatch(/do not pay again/);
    expect(sms).toMatch(/will not remind you again/);
    expect(emailCopy('ORDER_PAYMENT_REMINDER', d)?.cta?.label).toBe('Pay for this order');
  });

  it('is transactional (about the customer\'s own order) in both lists, so governance does not treat it as marketing', () => {
    expect(CUSTOMER_TRANSACTIONAL_TEMPLATES).toContain('ORDER_PAYMENT_REMINDER');
    expect(read('apps/api/src/infrastructure/notifications/messageClassification.ts')).toContain("'ORDER_PAYMENT_REMINDER'");
  });

  it('the query never reminds an order whose payment is clearing, paid, or already reminded', () => {
    const q = read('apps/api/src/infrastructure/commerce/DrizzleUnpaidOrderReminderCandidates.ts');
    // A pending attempt clears only while the provider is still speaking about it (2026-10-22: every abandoned
    // payment page used to block the reminder); declined orders are reminded too; a card-covered order never is.
    expect(q).toContain("a.status in ('verification_pending', 'completed')");
    expect(q).toContain("greatest(a.created_at, a.ipn_received_at, a.callback_received_at) > now() - interval '30 minutes'");
    expect(q).toContain("o.payment_status in ('unpaid', 'failed')");
    expect(q).toContain('o.total_amount > o.store_credit_applied_ugx');
    expect(q).toContain("':ORDER_PAYMENT_REMINDER'");
  });

  it('runs on a ticker started with the server', () => {
    expect(read('apps/api/src/interfaces/http/server.ts')).toContain('startUnpaidOrderReminderTicker();');
  });
});
