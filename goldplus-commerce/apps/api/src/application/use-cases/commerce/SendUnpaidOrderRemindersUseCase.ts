import type { IUnpaidOrderReminderCandidates } from '../../ports/IUnpaidOrderReminderCandidates';

/**
 * Gap analysis #2 (2026-10-20): abandoned checkouts. An online order that was placed and never paid is the closest
 * a shopper came to buying; until now nothing followed up. One reminder per order, about an hour after it was
 * placed (time to finish a Mobile Money prompt, or to give up on it), never after a day, when the customer would
 * not connect it to us.
 *
 * Never sent while a payment attempt is pending or verifying: the payment-pending message tells that customer NOT to
 * pay again, and a reminder would contradict it and risk a double charge (the candidates query enforces this).
 */
export const PAYMENT_REMINDER_AFTER_MINUTES = 60;
export const PAYMENT_REMINDER_UNTIL_HOURS = 24;
const BATCH = 50;

export class SendUnpaidOrderRemindersUseCase {
  constructor(
    private readonly candidates: IUnpaidOrderReminderCandidates,
    private readonly sendReminder: (orderId: string) => Promise<void>,
    /** ORDER_PAYMENT_REMINDERS=off stops them without a deploy. */
    private readonly enabled: () => boolean = () => true,
  ) {}

  async execute(now: Date): Promise<{ due: number; enqueued: number; failed: number; disabled?: true }> {
    if (!this.enabled()) return { due: 0, enqueued: 0, failed: 0, disabled: true };
    const orderIds = await this.candidates.findDue({
      placedBefore: new Date(now.getTime() - PAYMENT_REMINDER_AFTER_MINUTES * 60_000),
      placedAfter: new Date(now.getTime() - PAYMENT_REMINDER_UNTIL_HOURS * 3_600_000),
      limit: BATCH,
    });
    let enqueued = 0;
    let failed = 0;
    for (const orderId of orderIds) {
      try {
        await this.sendReminder(orderId);
        enqueued += 1;
      } catch {
        failed += 1;
      }
    }
    return { due: orderIds.length, enqueued, failed };
  }
}
