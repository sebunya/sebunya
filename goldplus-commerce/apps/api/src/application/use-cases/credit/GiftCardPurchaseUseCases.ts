import type { IPesaPalClient } from '../../ports/IPesaPalClient';
import type { GiftCardOutboxMessage, GiftCardPurchaseRecord, IGiftCardPurchaseRepository } from '../../ports/IGiftCardPurchaseRepository';
import type { ICreditRepository } from '../../ports/ICreditRepository';
import type { CreditCodeTools } from './CreditUseCases';
import { newCreditCode } from '../../../domain/credit/CreditInstrument';
import {
  GIFT_CARD_DAILY_STARTS_PER_BUYER, GIFT_CARD_DAILY_UGX_PER_BUYER, checkGiftCardPurchase, giftCardPurchaseReference,
  isGiftCardPurchaseReference, isUgandanMobile, maskPhone, maskPhoneForSms, scheduledSendDue, type GiftCardField, type GiftCardPurchaseRequest,
} from '../../../domain/credit/GiftCardPurchase';

/**
 * Customers buy a gift card online for someone else (self-service, 2026-10-21).
 *
 * start:  check the form, open a Pesapal payment under the purchase's own GC- reference, hand back its page.
 * settle: whichever door the news comes through (return leg, IPN, poller), ask Pesapal and believe only its answer.
 *         Paid -> the buyer's receipt; the card is issued and its code texted now, or on the morning of the chosen
 *         day. Each step is a compare-and-set, so replays and two replicas never issue twice.
 * sweep:  the poller: ask about payments nobody reported, close the abandoned, issue cards that are now due.
 *
 * Nothing here touches orders: no fulfilment, stock, delivery, loyalty or revenue. The card's value becomes a sale
 * when it is spent, on the order it pays for.
 */

/** The issuer recorded on cards bought online: not a staff member (credit_instruments.issued_by is not a user FK). */
export const ONLINE_GIFT_CARD_ISSUER_ID = '00000000-0000-4000-8000-00000000c1f7';

/** How long an unpaid (status 0) Pesapal transaction stays open before 0 is taken as final (as for orders). */
const UNPAID_GRACE_MS = 24 * 3_600_000;

export interface GiftCardPaymentConfig {
  ipnId: string | null;
  /** The API route Pesapal returns the customer to (the same one orders use; it routes by the GC- prefix). */
  callbackUrl: string;
  /** Storefront page that shows a purchase's outcome: …/gift-card/bought */
  resultPageUrl: string;
  /** Online gift card sales across all buyers in 24 hours, in UGX, beyond which online sales pause. */
  dailyShopCapUgx: number;
}

export type StartGiftCardResult =
  | { ok: true; reference: string; redirectUrl: string }
  | { ok: false; code: 'INVALID'; errors: Partial<Record<GiftCardField, string>> }
  | { ok: false; code: 'LIMIT' | 'NOT_CONFIGURED' | 'PROVIDER'; message: string };

export interface GiftCardPublicStatus {
  reference: string;
  status: 'awaiting_payment' | 'paid' | 'issued' | 'failed' | 'review' | 'refunded';
  amountUgx: number;
  recipientFirstName: string;
  /** The card as the buyer designed it (the buyer is the one holding this reference). */
  theme: string;
  fromName: string;
  message: string | null;
  recipientPhoneMasked: string;
  buyerPhoneMasked: string;
  sendTo: 'recipient' | 'buyer';
  deliverOn: string | null;
  textStatus: 'sent' | 'sending' | 'failed' | 'not_sent' | null;
}

const PART_SPENT = 'Part of this card has been spent or is reserved by an order, so the payment cannot be refunded in full here. Settle it with the buyer and refund the rest from the Pesapal dashboard.';
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const kampalaDateWords = (iso: string) =>
  new Date(`${iso}T09:00:00+03:00`).toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', weekday: 'long', day: 'numeric', month: 'long' });

export class GiftCardPurchaseUseCases {
  private readonly lastAsked = new Map<string, number>();
  constructor(
    private readonly repo: IGiftCardPurchaseRepository,
    private readonly credit: Pick<ICreditRepository, 'findById' | 'voidInstrument' | 'ledger'>,
    private readonly pesapal: IPesaPalClient,
    private readonly tools: CreditCodeTools & { referenceIndexes(): number[]; normalizePhone(raw: string): string },
    private readonly config: () => GiftCardPaymentConfig,
    private readonly log: (event: string, detail: Record<string, unknown>) => void = () => undefined,
  ) {}

  async start(input: GiftCardPurchaseRequest & { buyerUserId?: string | null }, now = new Date()): Promise<StartGiftCardResult> {
    const checked = checkGiftCardPurchase(input, now);
    if (!checked.ok) return { ok: false, code: 'INVALID', errors: checked.errors };
    const v = checked.value;
    const cfg = this.config();
    if (!cfg.ipnId) return { ok: false, code: 'NOT_CONFIGURED', message: 'Online gift cards are not available right now. Call us to buy one.' };

    const buyerPhone = this.tools.normalizePhone(v.buyerPhone);
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const activity = await this.repo.buyerActivity(buyerPhone, dayAgo);
    if (activity.started >= GIFT_CARD_DAILY_STARTS_PER_BUYER || activity.paidUgx + v.amountUgx > GIFT_CARD_DAILY_UGX_PER_BUYER) {
      return { ok: false, code: 'LIMIT', message: 'You have bought the most gift cards we can sell to one number online in a day. Call us and we will help you with more.' };
    }
    // A shop-wide ceiling: gift cards are how stolen cards and phones are turned into goods, so a burst of sales
    // pauses online sales for the day (staff can still sell at the counter) instead of running on unseen.
    if ((await this.repo.paidSince(dayAgo)) + v.amountUgx > cfg.dailyShopCapUgx) {
      this.log('gift_card_daily_cap_reached', { capUgx: cfg.dailyShopCapUgx });
      return { ok: false, code: 'LIMIT', message: 'Online gift card sales are paused for today. Call us or visit the shop and we will sell you one there.' };
    }

    let purchase: GiftCardPurchaseRecord | null = null;
    for (let attempt = 0; attempt < 3 && !purchase; attempt++) {
      try {
        purchase = await this.repo.create({
          reference: giftCardPurchaseReference(this.tools.referenceIndexes()), amountUgx: v.amountUgx,
          buyerName: v.buyerName, buyerPhone, buyerEmail: v.buyerEmail, buyerUserId: input.buyerUserId ?? null,
          fromName: v.fromName, recipientName: v.recipientName, recipientPhone: v.recipientPhone ? this.tools.normalizePhone(v.recipientPhone) : null,
          sendTo: v.sendTo, message: v.message, theme: v.theme, deliverOn: v.deliverOn,
        });
      } catch (err) {
        if (!/gift_card_purchases_reference_uq|duplicate key/i.test(String((err as Error)?.message ?? err))) throw err;
      }
    }
    if (!purchase) throw new Error('GIFT_CARD_REFERENCE_COLLISION');

    const [first, ...rest] = v.buyerName.split(' ');
    try {
      const page = await this.pesapal.submitOrderRequest({
        id: purchase.reference,
        currency: 'UGX',
        amount: purchase.amountUgx,
        description: `GoldPlus gift card ${purchase.reference}`,
        callback_url: cfg.callbackUrl,
        cancellation_url: `${cfg.resultPageUrl}?ref=${encodeURIComponent(purchase.reference)}&cancelled=1`,
        notification_id: cfg.ipnId,
        billing_address: { email_address: v.buyerEmail || 'billing@goldplus-uganda.com', phone_number: buyerPhone, first_name: first || 'Customer', last_name: rest.join(' ') || 'GoldPlus' },
      });
      await this.repo.recordStarted(purchase.id, page.order_tracking_id, page.redirect_url);
      return { ok: true, reference: purchase.reference, redirectUrl: page.redirect_url };
    } catch (err) {
      // Nothing was collected: the purchase stays awaiting payment with no transaction and the sweep closes it.
      this.log('gift_card_payment_start_failed', { reference: purchase.reference, error: String((err as Error)?.message ?? err) });
      return { ok: false, code: 'PROVIDER', message: 'We could not open the payment page just now. Nothing was charged. Please try again in a minute.' };
    }
  }

  /**
   * Learn a purchase's payment outcome from Pesapal. The caller's reference must match the tracking id's purchase;
   * a mismatch changes nothing. Returns the purchase as it now stands, or null when the ids name no purchase.
   */
  async settle(input: { trackingId: string; reference: string; source: 'callback' | 'ipn' | 'poll' }, now = new Date()): Promise<GiftCardPurchaseRecord | null> {
    const trackingId = input.trackingId.trim();
    const p = trackingId ? await this.repo.byTrackingId(trackingId) : null;
    if (!p || p.reference !== input.reference.trim()) return null;
    if (p.status === 'paid') await this.deliverIfDue(p, now);
    // A purchase we closed as failed/abandoned is asked again when the PROVIDER writes (IPN) or the buyer returns:
    // a payment completed after we gave up is real money, and its card is owed. The poller never re-asks them.
    const lateNews = (p.status === 'failed' || p.status === 'abandoned') && input.source !== 'poll';
    if (p.status !== 'awaiting_payment' && !lateNews) return this.repo.byReference(p.reference);

    let s;
    try {
      s = await this.pesapal.getTransactionStatus(trackingId, input.source === 'poll' ? { breakerName: 'pesapal-gift-card-poll' } : undefined);
    } catch (err) {
      this.log('gift_card_status_failed', { reference: p.reference, source: input.source, error: String((err as Error)?.message ?? err) });
      return p;
    }
    const providerStatus = `${s.status_code} ${String(s.payment_status_description ?? '').slice(0, 80)}`.trim();
    if (lateNews && s.status_code !== 1) return p; // still not paid: nothing to change
    if (s.merchant_reference !== p.reference || Number(s.amount) !== p.amountUgx || String(s.currency).toUpperCase() !== 'UGX') {
      // The provider disagrees with our record: a person looks before any card exists.
      await this.repo.markUnpaid(p.id, 'review', `MISMATCH ${s.merchant_reference} ${s.amount} ${s.currency} (${providerStatus})`);
      this.log('gift_card_payment_mismatch', { reference: p.reference, providerReference: s.merchant_reference, amount: s.amount, currency: s.currency });
      return this.repo.byReference(p.reference);
    }
    if (s.status_code === 1) {
      const paid = await this.repo.markPaid(
        p.id,
        { confirmationCode: s.confirmation_code ?? null, paymentMethod: s.payment_method ?? null, providerStatus, now },
        p.sendTo === 'recipient' ? this.paidReceipt(p) : null,
      );
      const fresh = await this.repo.byReference(p.reference);
      if (paid && fresh) await this.deliverIfDue(fresh, now);
      return this.repo.byReference(p.reference);
    }
    if (s.status_code === 0 && /^(invalid|pending)?$/i.test(String(s.payment_status_description ?? '').trim()) && now.getTime() - p.createdAt.getTime() < UNPAID_GRACE_MS) {
      return p; // not paid YET (Pesapal answers 0 before the PIN is entered); asked again later
    }
    // 2 failed, 3 reversed before we ever counted it as paid, or a 0 that names an outcome / outlived the grace.
    await this.repo.markUnpaid(p.id, 'failed', providerStatus);
    return this.repo.byReference(p.reference);
  }

  /** What the buyer's result page may show: no names in full, no numbers in full, never the code. */
  async publicStatus(reference: unknown, now = new Date()): Promise<GiftCardPublicStatus | null> {
    if (!isGiftCardPurchaseReference(reference)) return null;
    let p = await this.repo.byReference(reference);
    if (!p) return null;
    // The buyer is looking at the page: when Pesapal has not told us yet, ask it (the same settle as the IPN), at
    // most every 15 seconds per purchase however often the page is loaded.
    if (p.status === 'awaiting_payment' && p.orderTrackingId && (this.lastAsked.get(p.reference) ?? 0) < now.getTime() - 15_000) {
      this.lastAsked.set(p.reference, now.getTime());
      if (this.lastAsked.size > 5_000) this.lastAsked.clear();
      p = (await this.settle({ trackingId: p.orderTrackingId, reference: p.reference, source: 'callback' }, now)) ?? p;
    }
    return {
      reference: p.reference,
      status: p.status === 'abandoned' ? 'failed' : p.status,
      amountUgx: p.amountUgx,
      recipientFirstName: firstName(p.recipientName),
      theme: p.theme, fromName: p.fromName, message: p.message,
      recipientPhoneMasked: maskPhone(p.sendTo === 'recipient' ? p.recipientPhone : p.buyerPhone),
      buyerPhoneMasked: maskPhone(p.buyerPhone),
      sendTo: p.sendTo,
      deliverOn: p.deliverOn,
      textStatus: p.textStatus,
    };
  }

  /** The poller (both replicas; every write is a compare-and-set). */
  async sweep(now = new Date()): Promise<{ polled: number; abandoned: number; issued: number }> {
    let polled = 0, abandoned = 0, issued = 0;
    const ask = await this.repo.awaitingWithTransaction(new Date(now.getTime() - 10 * 60_000), new Date(now.getTime() - 7 * 86_400_000), 50);
    for (const p of ask) {
      polled += 1;
      await this.settle({ trackingId: p.orderTrackingId!, reference: p.reference, source: 'poll' }, now).catch((err) => this.log('gift_card_poll_failed', { reference: p.reference, error: String(err) }));
    }
    // A page never opened (nothing to ask) closes after a day; an opened one is asked for a week, then closed.
    for (const p of await this.repo.awaitingStale(new Date(now.getTime() - 24 * 3_600_000), 100)) {
      const giveUp = !p.orderTrackingId || p.createdAt.getTime() < now.getTime() - 7 * 86_400_000;
      if (giveUp && (await this.repo.markUnpaid(p.id, 'abandoned', p.orderTrackingId ? 'NO_PAYMENT_AFTER_7_DAYS' : 'PAYMENT_PAGE_NEVER_OPENED'))) abandoned += 1;
    }
    for (const p of await this.repo.paidNotIssued(100)) {
      if (await this.deliverIfDue(p, now).catch((err) => { this.log('gift_card_issue_failed', { reference: p.reference, error: String(err) }); return false; })) issued += 1;
    }
    return { polled, abandoned, issued };
  }

  forBuyer(userId: string) { return this.repo.forBuyer(userId, 50); }

  /**
   * The face of a card for whoever holds its code (the open page): its look, who it is from and for, and the
   * message. Only for a well-formed code; the holder already has the money, so this tells them nothing more.
   */
  async faceForCode(code: string) {
    return this.repo.faceByCodeHash(this.tools.hash(code));
  }
  recent(limit = 50) { return this.repo.recent(limit); }

  /**
   * Staff: the money goes back to the buyer. Only for a card nobody has spent from: it is cancelled first (so it can
   * never be spent after the refund), then Pesapal is asked to refund. Retrying after a failed provider call is safe:
   * a card already cancelled for this refund is not cancelled twice.
   */
  async refund(reference: string, actor: { id: string; username: string }, reason: string): Promise<{ ok: boolean; message: string; purchaseId?: string }> {
    const p = isGiftCardPurchaseReference(reference) ? await this.repo.byReference(reference) : null;
    if (!p || !['paid', 'issued', 'review'].includes(p.status)) return { ok: false, message: 'Only a paid purchase that has not been refunded can be refunded.' };
    if (reason.trim().length < 5) return { ok: false, message: 'Say why the money is going back.' };
    const result = await this.refundFound(p, actor, reason);
    return { ...result, purchaseId: p.id };
  }

  private async refundFound(p: GiftCardPurchaseRecord, actor: { id: string; username: string }, reason: string): Promise<{ ok: boolean; message: string }> {
    if (!p.confirmationCode) return { ok: false, message: 'Pesapal gave no confirmation code for this payment; refund it from the Pesapal dashboard, then cancel the card.' };
    if (p.instrumentId) {
      const card = await this.credit.findById(p.instrumentId);
      if (!card) return { ok: false, message: 'The card for this purchase was not found.' };
      if (card.status !== 'void') {
        if (card.balanceUgx !== card.initialValueUgx || (card.heldUgx ?? 0) > 0) return { ok: false, message: PART_SPENT };
        const voided = await this.credit.voidInstrument(card.id, actor.id, `Refunded to the buyer (${p.reference}): ${reason.trim()}`.slice(0, 500), new Date());
        if (voided === null) return { ok: false, message: 'The card could not be cancelled; nothing was refunded.' };
        // An order may have reserved part of it between the look and the cancel: then only what was left is cancelled.
        if (voided !== card.initialValueUgx) {
          return { ok: false, message: `An order reserved part of this card just now. The card is cancelled with UGX ${voided.toLocaleString('en-US')} that was left on it: refund that amount to the buyer from the Pesapal dashboard.` };
        }
      } else {
        // Already cancelled (an earlier refund whose Pesapal call failed, or staff): refund only if nothing was ever spent.
        const rows = await this.credit.ledger(card.id);
        const untouched = rows.every((r) => r.type === 'ISSUE' || r.type === 'VOID' || (r.type === 'HOLD' && r.holdState === 'released'));
        const voidedAll = rows.some((r) => r.type === 'VOID' && r.amountUgx === -card.initialValueUgx);
        if (!untouched || !voidedAll) return { ok: false, message: PART_SPENT };
      }
    } else if (!(await this.repo.markRefunded(p.id, `REFUNDING by ${actor.username}: ${reason.trim()}`.slice(0, 300), { unissuedOnly: true }))) {
      // Not issued yet (a scheduled card): it is closed FIRST, so the morning sweep can never issue a card for money
      // that went back. False: the sweep issued it a moment ago; look again.
      return { ok: false, message: 'The card was issued a moment ago. Open the purchase again and refund it from there.' };
    }
    try {
      const res = await this.pesapal.requestRefund({ confirmationCode: p.confirmationCode, amount: p.amountUgx, username: actor.username, remarks: `Gift card ${p.reference}: ${reason.trim()}`.slice(0, 200) });
      if (String(res.status) !== '200') return { ok: false, message: `Pesapal did not accept the refund (${res.message || res.status}). No card can be spent for this purchase now; refund it from the Pesapal dashboard.` };
    } catch (err) {
      return { ok: false, message: `Pesapal could not be reached (${String((err as Error)?.message ?? err).slice(0, 120)}). No card can be spent for this purchase now; refund it from the Pesapal dashboard.` };
    }
    await this.repo.markRefunded(p.id, `REFUND_REQUESTED by ${actor.username}: ${reason.trim()}`.slice(0, 300));
    return { ok: true, message: `Refund of UGX ${p.amountUgx.toLocaleString('en-US')} asked of Pesapal; the buyer gets it on the account they paid from.` };
  }

  /**
   * Staff: send the card to a different number (the buyer typed a wrong one, or the text failed). Before the card is
   * issued only the number changes; afterwards an untouched card is swapped for a new code in one transaction, so the
   * old code (possibly sitting on a stranger's phone) is dead before the new one is texted. A card anyone has spent
   * from, or that an order is holding, is refused: that money is no longer the buyer's to redirect.
   */
  async redirect(reference: string, phone: string, actorId: string, note: string, now = new Date()): Promise<{ ok: boolean; message: string; purchaseId?: string }> {
    const p = isGiftCardPurchaseReference(reference) ? await this.repo.byReference(reference) : null;
    if (!p) return { ok: false, message: 'No gift card purchase has that reference.' };
    if (p.sendTo !== 'recipient') return { ok: false, message: 'This code was texted to the buyer to hand over; change nothing here, call the buyer.', purchaseId: p.id };
    if (!isUgandanMobile(phone)) return { ok: false, message: 'Type a Ugandan mobile number (for example 0772 123456).', purchaseId: p.id };
    if (note.trim().length < 5) return { ok: false, message: 'Say why (for example "buyer typed the number wrong").', purchaseId: p.id };
    const recipientPhone = this.tools.normalizePhone(phone);
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = newCreditCode('gift_card', this.tools.randomIndexes());
      try {
        const r = await this.repo.redirect({
          purchaseId: p.id, recipientPhone, actorId, now, note: `Sent to a different number (${p.reference}): ${note.trim()}`.slice(0, 500),
          newCard: {
            codeHash: this.tools.hash(code), last4: code.slice(-4), issuedBy: ONLINE_GIFT_CARD_ISSUER_ID,
            reason: `Bought online ${p.reference} by ${p.buyerName}; re-sent to a corrected number`.slice(0, 500),
            message: {
              template: 'GIFT_CARD_RECEIVED', phone: recipientPhone, relatedEntity: 'credit_instrument', relatedEntityId: null,
              idempotencyKey: `gift-card-received:${p.id}:${code.slice(-4)}:${now.getTime()}`,
              data: {
                template: 'GIFT_CARD_RECEIVED', creditKind: 'gift_card', creditCode: code, valueUgx: p.amountUgx, fromName: p.fromName,
                giftMessage: p.message, customerName: p.recipientName, recipientName: p.recipientName, toBuyer: false, reference: p.reference,
              },
            },
          },
        });
        if (r.result === 'updated') return { ok: true, message: `Number changed to ${maskPhone(recipientPhone)}. The card goes there on its day.`, purchaseId: p.id };
        if (r.result === 'reissued') {
          this.log('gift_card_redirected', { reference: p.reference, instrumentId: r.instrumentId });
          return { ok: true, message: `Done. The old code no longer works; a new code was texted to ${maskPhone(recipientPhone)}.`, purchaseId: p.id };
        }
        if (r.result === 'touched') return { ok: false, message: 'Part of this card has been spent or is reserved by an order, so it cannot be moved. Nothing was changed.', purchaseId: p.id };
        return { ok: false, message: 'Only a paid gift card that was texted to the person it is for can be moved. Nothing was changed.', purchaseId: p.id };
      } catch (err) {
        if (!/credit_instruments_code_hash_uq|duplicate key/i.test(String((err as Error)?.message ?? err))) throw err;
      }
    }
    throw new Error('CREDIT_CODE_COLLISION');
  }

  /** Issue the card and text its code, when it is due. True when this call issued it. */
  private async deliverIfDue(p: GiftCardPurchaseRecord, now: Date): Promise<boolean> {
    if (p.status !== 'paid' || p.instrumentId || !scheduledSendDue(p.deliverOn, now)) return false;
    const toBuyer = p.sendTo === 'buyer';
    const holderPhone = toBuyer ? p.buyerPhone : p.recipientPhone!;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = newCreditCode('gift_card', this.tools.randomIndexes());
      try {
        const issued = await this.repo.issueCard({
          purchaseId: p.id, codeHash: this.tools.hash(code), last4: code.slice(-4), issuedBy: ONLINE_GIFT_CARD_ISSUER_ID, now,
          reason: `Bought online ${p.reference} by ${p.buyerName} (${p.paymentMethod ?? 'Pesapal'}${p.confirmationCode ? ` ${p.confirmationCode}` : ''})`.slice(0, 500),
          recipientName: p.recipientName,
          // The card belongs to whoever it was given to: their verified phone shows it in their account.
          recipientPhone: p.recipientPhone ?? (toBuyer ? p.buyerPhone : null),
          customerUserId: null,
          messages: [{
            template: 'GIFT_CARD_RECEIVED', phone: holderPhone, relatedEntity: 'credit_instrument', relatedEntityId: null,
            idempotencyKey: `gift-card-received:${p.id}`,
            data: {
              template: 'GIFT_CARD_RECEIVED', creditKind: 'gift_card', creditCode: code, valueUgx: p.amountUgx,
              fromName: p.fromName, giftMessage: p.message, customerName: toBuyer ? p.buyerName : p.recipientName,
              recipientName: p.recipientName, toBuyer, reference: p.reference,
            },
          }],
        });
        if (issued) this.log('gift_card_issued', { reference: p.reference, instrumentId: issued.instrumentId, scheduled: Boolean(p.deliverOn) });
        return Boolean(issued);
      } catch (err) {
        if (!/credit_instruments_code_hash_uq|duplicate key/i.test(String((err as Error)?.message ?? err))) throw err;
      }
    }
    throw new Error('CREDIT_CODE_COLLISION');
  }

  /** The buyer's "payment received" text, when the code goes to someone else. */
  private paidReceipt(p: GiftCardPurchaseRecord): GiftCardOutboxMessage {
    return {
      template: 'GIFT_CARD_PAID', phone: p.buyerPhone, email: p.buyerEmail, relatedEntity: 'gift_card_purchase', relatedEntityId: p.id,
      idempotencyKey: `gift-card-paid:${p.id}`,
      data: {
        template: 'GIFT_CARD_PAID', valueUgx: p.amountUgx, customerName: p.buyerName, recipientName: firstName(p.recipientName),
        recipientPhoneMasked: maskPhoneForSms(p.recipientPhone), deliverOnWords: p.deliverOn ? kampalaDateWords(p.deliverOn) : null, reference: p.reference,
      },
    };
  }
}
