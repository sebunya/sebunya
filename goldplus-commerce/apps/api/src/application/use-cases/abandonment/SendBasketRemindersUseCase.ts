import { isQuietHours } from '../../notifications/QuietHours';
import type { IBasketReminderGate } from '../first-party/BasketReminderConsentUseCases';

/**
 * Basket reminders (0210, gap analysis #1): a signed-in shopper who left items
 * in their basket is texted once about it, if they asked for such texts.
 *
 * Rules, all here so they can be read in one place:
 *  - only carts the hourly evaluator classed OPEN-abandoned (one definition of
 *    abandoned, platform-wide), owned by an account, still holding items;
 *  - not before an hour after classification (the shopper may be back) and
 *    never after two days (they would not connect the text to us);
 *  - one text per basket, at most one per customer per week;
 *  - only with the customer's own basket-reminder consent covering today's
 *    number and no STOP (the gate); a refusal is recorded so the basket is not
 *    re-read every hour;
 *  - held during quiet hours (21:00–08:00 Kampala).
 */
export const BASKET_REMINDER_AFTER_MINUTES = 60;
export const BASKET_REMINDER_UNTIL_HOURS = 48;
export const BASKET_REMINDER_PER_CUSTOMER_DAYS = 7;
const BATCH = 50;

export interface BasketReminderCandidate {
  abandonmentId: string;
  cartId: string;
  userId: string;
  itemCount: number;
  subtotalUgx: number;
  /** Up to two product names, biggest line first. */
  itemNames: string[];
}

export interface IBasketReminderCandidates {
  findDue(input: { classifiedBefore: Date; classifiedAfter: Date; noReminderSince: Date; limit: number }): Promise<BasketReminderCandidate[]>;
  markReminded(abandonmentId: string, now: Date, outcome: 'sent' | 'not_opted_in' | 'no_phone' | 'suppressed'): Promise<void>;
}

export class SendBasketRemindersUseCase {
  constructor(
    private readonly candidates: IBasketReminderCandidates,
    private readonly gate: IBasketReminderGate,
    private readonly send: (candidate: BasketReminderCandidate, phoneE164: string) => Promise<void>,
    /** BASKET_REMINDERS=off stops them without a deploy. */
    private readonly enabled: () => boolean = () => true,
  ) {}

  async execute(now: Date): Promise<{ due: number; sent: number; refused: number; failed: number; disabled?: true }> {
    if (!this.enabled()) return { due: 0, sent: 0, refused: 0, failed: 0, disabled: true };
    if (isQuietHours(now)) return { due: 0, sent: 0, refused: 0, failed: 0 };
    const due = await this.candidates.findDue({
      classifiedBefore: new Date(now.getTime() - BASKET_REMINDER_AFTER_MINUTES * 60_000),
      classifiedAfter: new Date(now.getTime() - BASKET_REMINDER_UNTIL_HOURS * 3_600_000),
      noReminderSince: new Date(now.getTime() - BASKET_REMINDER_PER_CUSTOMER_DAYS * 86_400_000),
      limit: BATCH,
    });
    let sent = 0;
    let refused = 0;
    let failed = 0;
    for (const c of due) {
      try {
        const gate = await this.gate.mayRemind(c.userId);
        if (!gate.allowed || !gate.phoneE164) {
          refused += 1;
          await this.candidates.markReminded(c.abandonmentId, now, gate.reason === 'SUPPRESSED' ? 'suppressed' : gate.reason === 'NO_PHONE' ? 'no_phone' : 'not_opted_in');
          continue;
        }
        await this.send(c, gate.phoneE164);
        await this.candidates.markReminded(c.abandonmentId, now, 'sent');
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    return { due: due.length, sent, refused, failed };
  }
}

/** "the Oraimo 10000mAh powerbank", "X and Y", "X and 2 more items": what the text names. */
export function basketItemsWords(names: string[], itemCount: number): string {
  const clean = names.map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 2);
  if (clean.length === 0) return itemCount === 1 ? '1 item' : `${itemCount} items`;
  const more = Math.max(0, itemCount - clean.length);
  if (clean.length === 1) return more === 0 ? clean[0] : `${clean[0]} and ${more} more item${more === 1 ? '' : 's'}`;
  return more === 0 ? `${clean[0]} and ${clean[1]}` : `${clean[0]}, ${clean[1]} and ${more} more item${more === 1 ? '' : 's'}`;
}
