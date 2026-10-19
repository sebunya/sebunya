import type { IReviewReminderCandidates } from '../../ports/IReviewReminderCandidates';

/** The delivered or collected message already asks on the day. The reminder
 *  comes once the goods have been used for a few days, and never for an order
 *  closed so long ago that the customer would not connect it to us. */
export const REVIEW_REMINDER_AFTER_DAYS = 4;
export const REVIEW_REMINDER_UNTIL_DAYS = 14;
const BATCH = 50;
const DAY_MS = 86_400_000;

/**
 * One reminder per order, ever: the outbox idempotency key is per order and
 * template, and the candidates query skips orders that already have one.
 */
export class SendReviewRemindersUseCase {
  constructor(
    private readonly candidates: IReviewReminderCandidates,
    private readonly sendReminder: (orderId: string) => Promise<void>,
  ) {}

  async execute(now: Date): Promise<{ due: number; enqueued: number; failed: number }> {
    const orderIds = await this.candidates.findDue({
      closedBefore: new Date(now.getTime() - REVIEW_REMINDER_AFTER_DAYS * DAY_MS),
      closedAfter: new Date(now.getTime() - REVIEW_REMINDER_UNTIL_DAYS * DAY_MS),
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
