import { isQuietHours } from '../../notifications/QuietHours';
import { gsmPlain } from '../../../domain/fulfilment/PaidOrderAlert';
import type { IBasketReminderGate } from '../first-party/BasketReminderConsentUseCases';
import type { HoldoutArm } from '../../../domain/measurement/Incrementality';

/**
 * Basket reminders (0210, gap analysis #1): a signed-in shopper who left items
 * in their basket is texted once about it, if they asked for such texts.
 *
 * Rules, all here so they can be read in one place:
 *  - only carts the hourly evaluator classed OPEN-abandoned (one definition of
 *    abandoned, platform-wide), owned by an account, still holding items;
 *  - not before an hour after classification (the shopper may be back) and
 *    never after two days (they would not connect the text to us);
 *  - one text per basket, at most one per customer per week, taken atomically
 *    per customer (claimForReminder), so two baskets or two replicas cannot
 *    both pass the cap;
 *  - only with the customer's own basket-reminder consent covering today's
 *    VERIFIED number on an active account, and no STOP (the gate); a refusal is
 *    recorded with its reason so the basket is not re-read every hour;
 *  - not a basket changed since it was classified, not a customer who has
 *    ordered since, and naming only what can still be bought (findDue);
 *  - the abandoned-basket holdout keeps its share unsent (the incrementality
 *    report's control group, as review and mission messages do);
 *  - held during quiet hours (21:00–08:00 Kampala), and the router refuses a
 *    queued one past its send-by time, in quiet hours or with the switch off.
 */
export const BASKET_REMINDER_AFTER_MINUTES = 60;
export const BASKET_REMINDER_UNTIL_HOURS = 48;
export const BASKET_REMINDER_PER_CUSTOMER_DAYS = 7;
/** A reminder not out within this long after it was queued is not sent at all (stale, or into the evening). */
export const BASKET_REMINDER_SEND_WITHIN_MINUTES = 60;
const BATCH = 50;
const QUIET_HOURS_MARGIN_MINUTES = 15;

export interface BasketReminderCandidate {
  abandonmentId: string;
  cartId: string;
  userId: string;
  itemCount: number;
  subtotalUgx: number;
  /** Up to two product names, biggest line first. */
  itemNames: string[];
}

/** Why a basket got no text (recorded, so it is not re-read every hour). */
export type BasketReminderRefusal = 'not_opted_in' | 'no_phone' | 'suppressed' | 'unverified' | 'inactive' | 'nothing_left' | 'held_out';

export interface IBasketReminderCandidates {
  findDue(input: { classifiedBefore: Date; classifiedAfter: Date; noReminderSince: Date; limit: number }): Promise<BasketReminderCandidate[]>;
  markReminded(abandonmentId: string, now: Date, outcome: BasketReminderRefusal): Promise<void>;
  /** Atomically takes the basket for one text (per-customer lock, cap re-checked); false = someone else has it or the cap is reached. */
  claimForReminder(input: { abandonmentId: string; userId: string; now: Date; noReminderSince: Date }): Promise<boolean>;
  settleReminder(abandonmentId: string, outcome: 'sent' | 'failed'): Promise<void>;
}

const REFUSAL_OF: Record<string, BasketReminderRefusal> = {
  SUPPRESSED: 'suppressed', NO_PHONE: 'no_phone', PHONE_NOT_VERIFIED: 'unverified', ACCOUNT_INACTIVE: 'inactive',
};

export class SendBasketRemindersUseCase {
  constructor(
    private readonly candidates: IBasketReminderCandidates,
    private readonly gate: IBasketReminderGate,
    private readonly send: (candidate: BasketReminderCandidate, phoneE164: string, sendBy: Date) => Promise<void>,
    /** BASKET_REMINDERS=off stops them without a deploy. */
    private readonly enabled: () => boolean = () => true,
    /** The abandoned-basket holdout ('hold' = this customer is in this wave's control group: nothing is sent). */
    private readonly holdout: (candidate: BasketReminderCandidate) => Promise<HoldoutArm> = async () => 'treat',
    private readonly log: (event: string, detail: Record<string, unknown>) => void = () => undefined,
  ) {}

  async execute(now: Date): Promise<{ due: number; sent: number; refused: number; failed: number; held: number; disabled?: true }> {
    if (!this.enabled()) return { due: 0, sent: 0, refused: 0, failed: 0, held: 0, disabled: true };
    // Not in quiet hours, nor in the last minutes before them: a reminder queued at 20:55 would be refused at 21:00
    // (dropped, while its basket read "sent"). Held here, the basket is simply picked up after 08:00.
    if (isQuietHours(now) || isQuietHours(new Date(now.getTime() + QUIET_HOURS_MARGIN_MINUTES * 60_000))) return { due: 0, sent: 0, refused: 0, failed: 0, held: 0 };
    const noReminderSince = new Date(now.getTime() - BASKET_REMINDER_PER_CUSTOMER_DAYS * 86_400_000);
    const due = await this.candidates.findDue({
      classifiedBefore: new Date(now.getTime() - BASKET_REMINDER_AFTER_MINUTES * 60_000),
      classifiedAfter: new Date(now.getTime() - BASKET_REMINDER_UNTIL_HOURS * 3_600_000),
      noReminderSince,
      limit: BATCH,
    });
    // A queued text older than this is not sent (the outbox retries for hours): the router reads it (sendBy).
    const sendBy = new Date(now.getTime() + BASKET_REMINDER_SEND_WITHIN_MINUTES * 60_000);
    let sent = 0, refused = 0, failed = 0, held = 0;
    for (const c of due) {
      try {
        if (c.itemCount <= 0) { refused += 1; await this.candidates.markReminded(c.abandonmentId, now, 'nothing_left'); continue; }
        const gate = await this.gate.mayRemind(c.userId);
        if (!gate.allowed || !gate.phoneE164) {
          refused += 1;
          await this.candidates.markReminded(c.abandonmentId, now, REFUSAL_OF[gate.reason] ?? 'not_opted_in');
          continue;
        }
        if ((await this.holdout(c)) === 'hold') { held += 1; await this.candidates.markReminded(c.abandonmentId, now, 'held_out'); continue; }
        if (!(await this.candidates.claimForReminder({ abandonmentId: c.abandonmentId, userId: c.userId, now, noReminderSince }))) continue;
        try {
          await this.send(c, gate.phoneE164, sendBy);
          await this.candidates.settleReminder(c.abandonmentId, 'sent');
          sent += 1;
        } catch (err) {
          await this.candidates.settleReminder(c.abandonmentId, 'failed').catch(() => undefined);
          throw err;
        }
      } catch (err) {
        failed += 1;
        this.log('basket_reminder_failed', { abandonmentId: c.abandonmentId, error: String((err as Error)?.message ?? err).slice(0, 200) });
      }
    }
    return { due: due.length, sent, refused, failed, held };
  }
}

/**
 * Why a queued reminder must not go out now, or null when it may. Read by the notification router at send time: the
 * outbox retries a failed send for hours, so a reminder queued at 20:55 could otherwise arrive at 23:00 or the next
 * day, and BASKET_REMINDERS=off must also stop the ones already queued. A reminder with no send-by time (queued before
 * 2026-10-29) is not sent: nothing says it is still fresh.
 */
export function basketReminderSendRefusal(data: Record<string, unknown>, now: Date, enabled: boolean): string | null {
  if (!enabled) return 'Basket reminders are switched off (BASKET_REMINDERS=off).';
  if (isQuietHours(now)) return 'Not sent: quiet hours (21:00 to 08:00 Kampala). A late reminder is dropped, not delayed.';
  const by = typeof data.notAfter === 'string' ? Date.parse(data.notAfter) : NaN;
  if (!Number.isFinite(by)) return 'Not sent: the reminder carries no send-by time.';
  if (now.getTime() > by) return `Not sent: past its send-by time (${new Date(by).toISOString()}).`;
  return null;
}

/** One product name in a reminder: plain GSM characters (one curly quote would bill the text as Unicode) and at most 40, cut at a word. */
function itemName(name: string): string {
  const n = gsmPlain(name);
  if (n.length <= 40) return n;
  const cut = n.slice(0, 40);
  const atWord = cut.lastIndexOf(' ');
  return (atWord >= 20 ? cut.slice(0, atWord) : cut).replace(/[\s.,;:!?-]+$/, '');
}

/** "the Oraimo 10000mAh powerbank", "X and Y", "X and 2 more items": what the text names. */
export function basketItemsWords(names: string[], itemCount: number): string {
  const clean = names.map(itemName).filter(Boolean).slice(0, 2);
  if (clean.length === 0) return itemCount === 1 ? '1 item' : `${itemCount} items`;
  const more = Math.max(0, itemCount - clean.length);
  if (clean.length === 1) return more === 0 ? clean[0] : `${clean[0]} and ${more} more item${more === 1 ? '' : 's'}`;
  return more === 0 ? `${clean[0]} and ${clean[1]}` : `${clean[0]}, ${clean[1]} and ${more} more item${more === 1 ? '' : 's'}`;
}
