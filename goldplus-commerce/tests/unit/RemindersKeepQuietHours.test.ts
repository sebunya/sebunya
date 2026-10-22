import { describe, expect, it } from 'vitest';
import { isQuietHours } from '../../apps/api/src/application/notifications/QuietHours';
import { SendUnpaidOrderRemindersUseCase } from '../../apps/api/src/application/use-cases/commerce/SendUnpaidOrderRemindersUseCase';
import { SendReviewRemindersUseCase } from '../../apps/api/src/application/use-cases/reviews/SendReviewRemindersUseCase';
import { CreditExpiryRemindersUseCase } from '../../apps/api/src/application/use-cases/credit/CreditUseCases';
import { smsText } from '../../apps/api/src/application/notifications/CustomerMessages';

/**
 * Customer reminders kept no hours: the card-expiry text always went out between 00:00 and 01:00 Kampala (an expiry is
 * 23:59:59 local), and review/payment reminders at whatever hour the ticker ran (2026-10-22 review). Campaigns already
 * kept 21:00-08:00; every reminder does now.
 */
const NIGHT = new Date('2026-10-22T21:30:00Z'); // 00:30 Kampala
const MORNING = new Date('2026-10-22T05:30:00Z'); // 08:30 Kampala

describe('reminders keep quiet hours (21:00-08:00 Kampala)', () => {
  it('the rule', () => {
    expect(isQuietHours(NIGHT)).toBe(true);
    expect(isQuietHours(MORNING)).toBe(false);
  });

  it('payment, review and card-expiry reminders hold at night and go in the morning', async () => {
    const pay = new SendUnpaidOrderRemindersUseCase({ findDue: async () => ['o1'] }, async () => undefined);
    const review = new SendReviewRemindersUseCase({ findDue: async () => ['o1'] }, async () => undefined);
    const card = new CreditExpiryRemindersUseCase(
      { expiringSoon: async () => [{ instrumentId: 'c1', phone: '0772000000', kind: 'gift_card', last4: '1234', balanceUgx: 10_000, expiresAt: new Date('2026-10-28T20:59:59Z') }] } as never,
      { send: async () => undefined } as never,
    );
    expect((await pay.execute(NIGHT)).enqueued).toBe(0);
    expect((await review.execute(NIGHT)).enqueued).toBe(0);
    expect((await card.execute(NIGHT)).sent).toBe(0);
    expect((await pay.execute(MORNING)).enqueued).toBe(1);
    expect((await review.execute(MORNING)).enqueued).toBe(1);
    expect((await card.execute(MORNING)).sent).toBe(1);
  });

  it('the payment reminder asks only for what is still to pay after a gift card', () => {
    const text = smsText('ORDER_PAYMENT_REMINDER', { orderNumber: 'GP-1', totalUgx: 100_000, storeCreditAppliedUgx: 80_000, amountDueUgx: 20_000 } as never);
    expect(text).toContain('UGX 20,000');
    expect(text).not.toContain('100,000');
  });
});
