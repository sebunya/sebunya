import type { GiftCardPurchaseStatus, GiftCardSendTo, GiftCardTheme } from '../../domain/credit/GiftCardPurchase';

/** What the card looks like to the person it is for (the open page): never the buyer's details. */
export interface GiftCardFace {
  theme: GiftCardTheme;
  fromName: string;
  toName: string;
  message: string | null;
  /** What the card was worth when given (never the balance): the holder may choose to show it when sharing. */
  originalUgx: number;
  /** 0201: the buyer's photo, when there is one. */
  photoId: string | null;
}

/** 0201: turns whatever a phone sent into a safe square JPEG (no metadata), or refuses it. */
export interface IGiftCardPhotoProcessor {
  process(input: Buffer): Promise<{ image: Buffer; width: number; height: number }>;
}

/** 0199: a gift card bought online (domain/credit/GiftCardPurchase.ts). */
export interface GiftCardPurchaseRecord {
  id: string;
  reference: string;
  amountUgx: number;
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string | null;
  buyerUserId: string | null;
  fromName: string;
  recipientName: string;
  recipientPhone: string | null;
  sendTo: GiftCardSendTo;
  message: string | null;
  theme: GiftCardTheme;
  deliverOn: string | null;
  status: GiftCardPurchaseStatus;
  orderTrackingId: string | null;
  redirectUrl: string | null;
  providerStatus: string | null;
  confirmationCode: string | null;
  paymentMethod: string | null;
  instrumentId: string | null;
  /** 0201: the buyer's photo, when they added one (and staff have not removed it). */
  photoId: string | null;
  /** The issued card's last four, when issued. */
  cardLast4: string | null;
  /**
   * Did the text carrying the code reach a phone? sent: a provider accepted it; sending: queued or retrying;
   * failed: given up; not_sent: handled with live sending switched off; null: no card yet.
   */
  textStatus: 'sent' | 'sending' | 'failed' | 'not_sent' | null;
  createdAt: Date;
  paidAt: Date | null;
  issuedAt: Date | null;
}

/** A customer message written in the same transaction as the card it belongs to (transactional outbox). */
export interface GiftCardOutboxMessage {
  template: 'GIFT_CARD_RECEIVED' | 'GIFT_CARD_PAID';
  phone: string;
  email?: string | null;
  data: Record<string, unknown>;
  idempotencyKey: string;
  relatedEntity: 'credit_instrument' | 'gift_card_purchase';
  /** null: the card's id, filled in by the repository once the card exists. */
  relatedEntityId: string | null;
}

export interface IGiftCardPurchaseRepository {
  /**
   * The purchase, and (when photoId is given) its photo claimed in the same transaction. Throws PHOTO_UNAVAILABLE
   * when that photo does not exist, is already on another purchase, or is older than two days.
   */
  create(input: Omit<GiftCardPurchaseRecord, 'id' | 'status' | 'orderTrackingId' | 'redirectUrl' | 'providerStatus' | 'confirmationCode' | 'paymentMethod' | 'instrumentId' | 'cardLast4' | 'textStatus' | 'createdAt' | 'paidAt' | 'issuedAt'>): Promise<GiftCardPurchaseRecord>;
  byReference(reference: string): Promise<GiftCardPurchaseRecord | null>;
  /** 0201: a processed photo, kept until a purchase claims it (or three days pass). */
  savePhoto(image: Buffer, width: number, height: number, uploaderKey: string | null): Promise<string>;
  /** The photo's JPEG bytes, or null: unknown, removed, or an unclaimed upload older than `unclaimedAfter`. */
  photoImage(id: string, unclaimedAfter: Date): Promise<Buffer | null>;
  /** Photos uploaded since `since`, claimed or not: shop-wide, or by one uploader (the daily ceilings). */
  photosSince(since: Date, uploaderKey?: string): Promise<number>;
  /**
   * Photos no purchase claimed, uploaded before `unclaimedBefore`; photos of purchases that ended unpaid or
   * refunded before `endedBefore`; and photos of cards that were used up, cancelled or expired before `cardDoneBefore`
   * (the picture is kept while the card can still be opened and spent, not for ever).
   */
  deleteStalePhotos(unclaimedBefore: Date, endedBefore: Date, cardDoneBefore: Date): Promise<number>;
  /** The purchase whose issued card has this code hash (the holder of the code is the person it is for). */
  purchaseIdByCodeHash(codeHash: string): Promise<string | null>;
  /** Staff: take the photo off a purchase (and delete it). */
  removePhoto(purchaseId: string): Promise<boolean>;
  byTrackingId(trackingId: string): Promise<GiftCardPurchaseRecord | null>;
  /** The provider transaction opened for this purchase (once; a second call changes nothing). */
  recordStarted(id: string, trackingId: string, redirectUrl: string): Promise<void>;
  /** Purchases this buyer phone (last nine digits) started, and paid in UGX, since `since`. */
  buyerActivity(buyerPhone: string, since: Date): Promise<{ started: number; paidUgx: number }>;
  /** UGX paid for online gift cards by everyone since `since` (the shop-wide daily ceiling). */
  paidSince(since: Date): Promise<number>;
  /**
   * awaiting_payment (or failed / abandoned: a payment Pesapal confirms after we gave up) -> paid, with the provider's confirmation, and (in the same transaction) the buyer's
   * "payment received" message when one is given. False when the purchase was not awaiting payment (a replay).
   */
  markPaid(id: string, input: { confirmationCode: string | null; paymentMethod: string | null; providerStatus: string; now: Date }, receipt: GiftCardOutboxMessage | null): Promise<boolean>;
  /** awaiting_payment -> failed | abandoned | review (review also from failed / abandoned: late money that disagrees). */
  markUnpaid(id: string, status: 'failed' | 'abandoned' | 'review', providerStatus: string): Promise<boolean>;
  /**
   * paid -> issued: the card (credit_instruments + its ISSUE ledger row) and the message carrying its code, in
   * one transaction under the purchase's row lock. Null when the purchase is not paid-and-unissued (already
   * issued by another replica, refunded, or never paid): nothing is written.
   */
  issueCard(input: {
    purchaseId: string; codeHash: string; last4: string; reason: string; issuedBy: string;
    recipientName: string; recipientPhone: string | null; customerUserId: string | null; now: Date;
    messages: GiftCardOutboxMessage[];
  }): Promise<{ instrumentId: string } | null>;
  /** Paid, not yet issued: every purchase whose card is owed (due or scheduled). */
  paidNotIssued(limit: number): Promise<GiftCardPurchaseRecord[]>;
  /** Awaiting payment with a provider transaction, created in [newerThan, olderThan]: the poller asks Pesapal. */
  awaitingWithTransaction(olderThan: Date, newerThan: Date, limit: number): Promise<GiftCardPurchaseRecord[]>;
  /** Awaiting payment and created before `olderThan`: closed as abandoned when there is nothing to ask. */
  awaitingStale(olderThan: Date, limit: number): Promise<GiftCardPurchaseRecord[]>;
  forBuyer(userId: string, limit: number): Promise<GiftCardPurchaseRecord[]>;
  /** The face of the card bought online whose code hashes to this, or null (a staff-issued card has none). */
  faceByCodeHash(codeHash: string): Promise<GiftCardFace | null>;
  recent(limit: number): Promise<GiftCardPurchaseRecord[]>;
  /**
   * Staff: the code goes to a different number (a typo is the commonest gift card call). One transaction under the
   * purchase's row lock. Not issued yet: only the number changes. Issued and untouched: the old card is cancelled in
   * full, a new one (new code) is issued for the same value, and its text is written. Anything spent, reserved or
   * changed on the old card: 'touched', nothing written.
   */
  redirect(input: {
    purchaseId: string; recipientPhone: string; actorId: string; now: Date; note: string;
    newCard: { codeHash: string; last4: string; reason: string; issuedBy: string; message: GiftCardOutboxMessage };
  }): Promise<{ result: 'updated' | 'reissued'; instrumentId: string | null } | { result: 'touched' | 'not_redirectable' }>;
  /**
   * Staff: the money goes back to the buyer. Paid/issued/review -> refunded. `unissuedOnly`: only while no card
   * exists (closes a scheduled purchase before its card can be issued).
   */
  markRefunded(id: string, note: string, opts?: { unissuedOnly?: boolean }): Promise<boolean>;
}
