import { isQuietHours } from '../../notifications/QuietHours';
import { formatUgx } from '../../notifications/CustomerMessages';
import type { CreditInstrumentView, ICreditRepository } from '../../ports/ICreditRepository';
import { checkIssue, maskCreditCode, newCreditCode, normalizeCreditCode, type CreditKind } from '../../../domain/credit/CreditInstrument';
import { isValidUgandanPhone, normalizePhone } from '../../services/validationHelpers';

/**
 * Store credit and gift cards: staff issue, approve, void and adjust; anyone holding a code may check it.
 * (Gap analysis #17; spending is at checkout, inside the order transaction.)
 */
export interface CreditCodeTools {
  hash(code: string): string;
  randomIndexes(): number[];
}
export interface CreditIssuedNotifier {
  /** Texts the code to the recipient. Only for an instrument that is spendable now. */
  send(input: { instrumentId: string; phone: string; kind: CreditKind; valueUgx: number; code: string; recipientName: string | null }): Promise<void>;
}

const ISSUE_MESSAGES: Record<string, string> = {
  BAD_AMOUNT: 'Enter a whole amount of at least UGX 1,000.',
  TOO_LARGE: 'One card can hold at most UGX 5,000,000.',
  NEEDS_REASON: 'Say why this credit is being issued (for example "Sold at the counter" or "Refund for GP-…").',
  BAD_PHONE: 'Enter the recipient’s Ugandan phone number, or leave it empty.',
  BAD_ORDER: 'No order has that number. Check it (it starts with GP-), or leave it empty.',
};

export class IssueCreditUseCase {
  constructor(private readonly repo: ICreditRepository, private readonly tools: CreditCodeTools, private readonly notifier: CreditIssuedNotifier | null) {}

  async execute(input: {
    kind: CreditKind; amountUgx: number; reason: string; recipientName?: string | null; recipientPhone?: string | null;
    actorId: string; expiresAt?: Date | null;
    /** Store credit for an order (a refund as credit): links the order and the customer's account, and fills their name and phone. */
    orderNumber?: string | null;
  }): Promise<{ ok: true; id: string; code: string; masked: string; status: 'active' | 'pending_approval'; texted: boolean } | { ok: false; code: string; message: string }> {
    const check = checkIssue({ amountUgx: input.amountUgx, reason: input.reason ?? '' });
    if (!check.ok) return { ok: false, code: check.code, message: ISSUE_MESSAGES[check.code] };
    const orderRef = (input.orderNumber ?? '').trim().toUpperCase();
    const forOrder = orderRef ? await this.repo.orderForCredit(orderRef) : null;
    if (orderRef && !forOrder) return { ok: false, code: 'BAD_ORDER', message: ISSUE_MESSAGES.BAD_ORDER };
    const phoneRaw = ((input.recipientPhone ?? '').trim() || forOrder?.phone || '').trim();
    if (phoneRaw && !isValidUgandanPhone(phoneRaw)) return { ok: false, code: 'BAD_PHONE', message: ISSUE_MESSAGES.BAD_PHONE };
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const status = check.needsSecondApproval ? 'pending_approval' as const : 'active' as const;

    // A collision of 55 random bits is not expected; the unique index would refuse one, and a new code is drawn.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = newCreditCode(input.kind, this.tools.randomIndexes());
      try {
        const { id } = await this.repo.issue({
          kind: input.kind, codeHash: this.tools.hash(code), last4: code.slice(-4), valueUgx: input.amountUgx, reason: input.reason.trim().slice(0, 500),
          status, recipientName: ((input.recipientName ?? '').trim() || forOrder?.name || '').slice(0, 120) || null, recipientPhone: phone,
          customerUserId: forOrder?.userId ?? null, sourceOrderId: forOrder?.id ?? null, issuedBy: input.actorId, expiresAt: input.expiresAt ?? null,
        });
        let texted = false;
        if (status === 'active' && phone && this.notifier) {
          await this.notifier.send({ instrumentId: id, phone, kind: input.kind, valueUgx: input.amountUgx, code, recipientName: ((input.recipientName ?? '').trim() || forOrder?.name) ?? null }).then(() => { texted = true; }).catch(() => undefined);
        }
        return { ok: true, id, code, masked: maskCreditCode(code), status, texted };
      } catch (err) {
        if (!/credit_instruments_code_hash_uq|duplicate key/i.test(String((err as Error)?.message ?? err))) throw err;
      }
    }
    throw new Error('CREDIT_CODE_COLLISION');
  }
}

export class ManageCreditUseCases {
  constructor(
    private readonly repo: ICreditRepository,
    private readonly tools: CreditCodeTools,
    /** The refund loyalty port (ApplyRefundToLoyaltyUseCase): an item given back to a card takes back its share of the points, as a cash partial refund does. */
    private readonly refundLoyalty?: { execute(input: { orderId: string; refundedShareBps: number; reason: string }): Promise<void> },
  ) {}

  list(input: { status?: string | null; kind?: CreditKind | null; limit?: number }) { return this.repo.list({ limit: input.limit ?? 100, status: input.status ?? null, kind: input.kind ?? null }); }
  async detail(id: string) {
    const instrument = await this.repo.findById(id);
    return instrument ? { instrument, ledger: await this.repo.ledger(id) } : null;
  }
  /** The second person, never the issuer (enforced in SQL too). */
  approve(id: string, approverId: string) { return this.repo.approve(id, approverId, new Date()); }
  async void(id: string, actorId: string, note: string): Promise<{ ok: boolean; voidedUgx?: number; message?: string }> {
    if (note.trim().length < 5) return { ok: false, message: 'Say why the card is being cancelled.' };
    const left = await this.repo.voidInstrument(id, actorId, note.trim().slice(0, 500), new Date());
    return left === null ? { ok: false, message: 'That card is already cancelled or does not exist.' } : { ok: true, voidedUgx: left };
  }
  async adjust(id: string, amountUgx: number, actorId: string, note: string): Promise<{ ok: boolean; message?: string }> {
    if (!Number.isInteger(amountUgx) || amountUgx === 0 || Math.abs(amountUgx) > 5_000_000) return { ok: false, message: 'Enter a whole, non-zero amount.' };
    if (note.trim().length < 5) return { ok: false, message: 'Say why the balance is being changed.' };
    return (await this.repo.adjust(id, amountUgx, actorId, note.trim().slice(0, 500)))
      ? { ok: true }
      : { ok: false, message: 'Not changed: the card is cancelled, or the balance would go below zero.' };
  }

  /** What a code holder may see: the kind, the last four, the spendable balance. Nothing about who holds it. */
  async check(typed: unknown): Promise<{ ok: true; kind: CreditKind; masked: string; balanceUgx: number; usable: boolean; reason: string | null } | { ok: false }> {
    const parsed = normalizeCreditCode(typed);
    if (!parsed) return { ok: false };
    const i = await this.repo.findByCodeHash(this.tools.hash(parsed.code));
    if (!i) return { ok: false };
    const expired = i.expiresAt !== null && i.expiresAt <= new Date();
    const reason = i.status === 'void' ? 'This card was cancelled.' : i.status === 'pending_approval' ? 'This card is waiting for a second approval at GoldPlus.' : expired ? 'This card has expired.' : i.balanceUgx <= 0 && (i.heldUgx ?? 0) > 0
        // Not spent: an order that has not been paid yet is holding it. Said plainly, so the holder does not think it is gone.
        ? `${formatUgx(i.heldUgx ?? 0)} on this card is reserved for an order that has not been paid yet. Pay for that order, or call us to cancel it and free the card.`
        : i.balanceUgx <= 0 ? 'This card has no balance left.' : null;
    return { ok: true, kind: i.kind, masked: maskCreditCode(parsed.code), balanceUgx: i.status === 'void' || expired ? 0 : i.balanceUgx, usable: reason === null, reason };
  }

  forCustomer(userId: string): Promise<CreditInstrumentView[]> { return this.repo.forCustomer(userId); }

  /** The accountant's view: every movement in [from, to), at most 50,000 rows. */
  ledgerBetween(from: Date, to: Date) {
    if (!(from < to) || to.getTime() - from.getTime() > 400 * 86_400_000) return Promise.resolve(null);
    return this.repo.ledgerBetween(from, to, 50_000);
  }

  /** Give back to the card part of what an order spent from it (an item returned). Never more than it spent. */
  async returnToCard(orderNumber: unknown, amountUgx: number, actorId: string, note: string) {
    const ref = typeof orderNumber === 'string' ? orderNumber.trim().toUpperCase() : '';
    if (!/^GP-[A-Z0-9-]{4,40}$/.test(ref)) return { ok: false as const, message: 'Type the order number (it starts with GP-).' };
    if (note.trim().length < 5) return { ok: false as const, message: 'Say why (for example, which item came back).' };
    const result = await this.repo.returnToCardForOrder(ref, amountUgx, actorId, note.trim().slice(0, 500));
    if (result.ok && this.refundLoyalty && result.orderTotalUgx > 0) {
      // Isolated like the cash path: the money is already back on the card; points can be corrected by hand.
      await this.refundLoyalty
        .execute({ orderId: result.orderId, refundedShareBps: Math.min(10_000, Math.floor((result.refundedSoFarUgx * 10_000) / result.orderTotalUgx)), reason: 'Item given back to the gift card' })
        .catch(() => undefined);
    }
    return result;
  }
}

/** 0196: messages about a card that never carry its code (so nothing needs scrubbing afterwards). */
export interface CreditNoticeSender {
  send(input: { template: 'CREDIT_USED' | 'CREDIT_EXPIRING'; instrumentId: string; phone: string; idempotencyKey: string; data: Record<string, unknown> }): Promise<void>;
}

const sameNumber = (a: string | null, b: string | null) => {
  const d = (s: string | null) => (s ?? '').replace(/\D/g, '').slice(-9);
  return d(a).length === 9 && d(a) === d(b);
};

/**
 * After a paid order spent a card: tell the card's holder when the order was someone else's (a gift card used by
 * another person). The buyer already reads the split in their payment message, so they are not texted twice.
 */
export class NotifyCardUsedUseCase {
  constructor(private readonly repo: ICreditRepository, private readonly sender: CreditNoticeSender) {}
  async execute(orderId: string): Promise<'sent' | 'skipped'> {
    const c = await this.repo.cardSpentOnOrder(orderId);
    if (!c || !c.recipientPhone || c.spentUgx <= 0 || sameNumber(c.recipientPhone, c.orderPhone)) return 'skipped';
    await this.sender.send({
      template: 'CREDIT_USED', instrumentId: c.instrumentId, phone: c.recipientPhone, idempotencyKey: `credit-used:${orderId}`,
      data: { template: 'CREDIT_USED', creditKind: c.kind, creditLast4: c.last4, spentUgx: c.spentUgx, balanceUgx: c.balanceUgx, orderNumber: c.orderNumber },
    });
    return 'sent';
  }
}

/** The one reminder, a week before, that a card with money left is about to end. Idempotent per card. */
export class CreditExpiryRemindersUseCase {
  constructor(private readonly repo: ICreditRepository, private readonly sender: CreditNoticeSender) {}
  async execute(now: Date): Promise<{ due: number; sent: number }> {
    if (isQuietHours(now)) return { due: 0, sent: 0 }; // held until 08:00 Kampala
    const due = await this.repo.expiringSoon(now, new Date(now.getTime() + 7 * 86_400_000), 200);
    let sent = 0;
    for (const c of due) {
      try {
        await this.sender.send({
          template: 'CREDIT_EXPIRING', instrumentId: c.instrumentId, phone: c.phone, idempotencyKey: `credit-expiring:${c.instrumentId}`,
          data: { template: 'CREDIT_EXPIRING', creditKind: c.kind, creditLast4: c.last4, balanceUgx: c.balanceUgx,
            expiresAt: c.expiresAt.toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'long', year: 'numeric' }) },
        });
        sent += 1;
      } catch { /* the next run tries again; the key keeps it to one message */ }
    }
    return { due: due.length, sent };
  }
}

