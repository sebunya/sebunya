/**
 * A gift card a customer buys online for someone else (self-service, 2026-10-21).
 *
 * Paid through Pesapal under its own reference, never as an order: a gift card is not goods, so it must not reach
 * fulfilment, stock, delivery, loyalty or revenue (the card's value counts as a sale when it is SPENT, on the order
 * it pays for). The card is issued only once Pesapal confirms the money.
 *
 * Pure: no database, no clock of its own, no randomness of its own.
 */
import { GIFT_CARD_FROM_MAX, GIFT_CARD_MESSAGE_MAX, GIFT_CARD_NAME_MAX, clipText, unsafeGiftText } from '@goldplus/shared';
import { SECOND_APPROVAL_ABOVE_UGX } from './CreditInstrument';
import { GIFT_CARD_OCCASIONS, isGiftCardOccasion, type GiftCardOccasion } from './GiftCardOccasions';
import { isGiftCardPhotoId } from './GiftCardPhoto';

export const GIFT_CARD_MIN_UGX = 10_000;
/** Online cards never need a second staff approval: the ceiling is the approval threshold. */
export const GIFT_CARD_MAX_UGX = SECOND_APPROVAL_ABOVE_UGX;
export const GIFT_CARD_PRESETS_UGX: readonly number[] = Object.freeze([20_000, 50_000, 100_000, 200_000]);
/** How far ahead a card may be scheduled (a birthday next month, not next year). */
export const GIFT_CARD_SCHEDULE_MAX_DAYS = 90;
/** The hour (Kampala) a scheduled card is texted on its day: a morning message, never one at midnight. */
export const GIFT_CARD_SCHEDULED_SEND_HOUR_EAT = 9;
/** A buyer's phone may start this many purchases a day, and pay at most this much in a day. */
export const GIFT_CARD_DAILY_STARTS_PER_BUYER = 6;
export const GIFT_CARD_DAILY_UGX_PER_BUYER = 1_000_000;

// The text rules are shared with the storefront, which checks the same things before the buyer leaves the page.
// The note is shown on the card, never in the text message.
export { GIFT_CARD_FROM_MAX, GIFT_CARD_MESSAGE_MAX, unsafeGiftText };

export type GiftCardSendTo = 'recipient' | 'buyer';
/** The card's look is its occasion (GiftCardOccasions.ts: one list; the storefront draws each; the database checks it). */
export const GIFT_CARD_THEMES = GIFT_CARD_OCCASIONS;
export type GiftCardTheme = GiftCardOccasion;
export const isGiftCardTheme = isGiftCardOccasion;
export type GiftCardPurchaseStatus = 'awaiting_payment' | 'paid' | 'issued' | 'failed' | 'abandoned' | 'review' | 'refunded';

export interface GiftCardPurchaseRequest {
  amountUgx: unknown;
  recipientName: unknown;
  recipientPhone: unknown;
  sendTo: unknown;
  message: unknown;
  fromName: unknown;
  buyerName: unknown;
  buyerPhone: unknown;
  buyerEmail: unknown;
  deliverOn: unknown;
  theme?: unknown;
  /** 0201: the id the photo upload handed back, or empty. */
  photoId?: unknown;
}

export interface CleanGiftCardPurchase {
  amountUgx: number;
  recipientName: string;
  /** Raw as typed (validated); infrastructure normalises it to +256… */
  recipientPhone: string | null;
  sendTo: GiftCardSendTo;
  message: string | null;
  fromName: string;
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string | null;
  /** YYYY-MM-DD in Kampala, or null to send as soon as it is paid. */
  deliverOn: string | null;
  theme: GiftCardTheme;
  photoId: string | null;
}

export type GiftCardField = 'amountUgx' | 'recipientName' | 'recipientPhone' | 'sendTo' | 'message' | 'fromName' | 'buyerName' | 'buyerPhone' | 'buyerEmail' | 'deliverOn' | 'photo';

// Control characters (a newline would let a message forge a second line of our SMS) become spaces.
const controlChars = (v: string) => Array.from(v, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');
const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? clipText(controlChars(v).replace(/\s+/g, ' ').trim(), max) : '';

/** Same rule as validationHelpers.isValidUgandanPhone (kept pure here: the domain imports no application code). */
export function isUgandanMobile(raw: string): boolean {
  const clean = raw.replace(/[\s+()-]/g, '');
  return /^(7\d{8}|07\d{8}|2567\d{8})$/.test(clean);
}

const lastNine = (raw: string | null) => (raw ?? '').replace(/\D/g, '').slice(-9);

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date in Kampala (UTC+3, no daylight saving), as YYYY-MM-DD. */
export function kampalaToday(now: Date): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Is a card scheduled for `deliverOn` due now? On its day from the morning hour, or any time after its day. */
export function scheduledSendDue(deliverOn: string | null, now: Date): boolean {
  if (!deliverOn) return true;
  const today = kampalaToday(now);
  if (deliverOn < today) return true;
  if (deliverOn > today) return false;
  const hourEat = new Date(now.getTime() + 3 * 3_600_000).getUTCHours();
  return hourEat >= GIFT_CARD_SCHEDULED_SEND_HOUR_EAT;
}

export function checkGiftCardPurchase(
  input: GiftCardPurchaseRequest,
  now: Date,
): { ok: true; value: CleanGiftCardPurchase } | { ok: false; errors: Partial<Record<GiftCardField, string>> } {
  const errors: Partial<Record<GiftCardField, string>> = {};
  const amount = typeof input.amountUgx === 'number' ? input.amountUgx : Number(String(input.amountUgx ?? '').replace(/[,\s]/g, ''));
  if (!Number.isInteger(amount) || amount < GIFT_CARD_MIN_UGX || amount > GIFT_CARD_MAX_UGX || amount % 1_000 !== 0) {
    errors.amountUgx = `Choose an amount from UGX ${GIFT_CARD_MIN_UGX.toLocaleString('en-US')} to UGX ${GIFT_CARD_MAX_UGX.toLocaleString('en-US')}, in thousands.`;
  }
  const sendTo: GiftCardSendTo = input.sendTo === 'buyer' ? 'buyer' : 'recipient';

  const recipientName = text(input.recipientName, GIFT_CARD_NAME_MAX);
  if (recipientName.length < 2) errors.recipientName = 'Type the name of the person the card is for.';
  else if (unsafeGiftText(recipientName)) errors.recipientName = 'Use only their name here.';

  const recipientPhoneRaw = text(input.recipientPhone, 20);
  if (sendTo === 'recipient' && !isUgandanMobile(recipientPhoneRaw)) {
    errors.recipientPhone = 'Type their Ugandan mobile number (for example 0772 123456). The code is texted to it.';
  } else if (sendTo === 'buyer' && recipientPhoneRaw && !isUgandanMobile(recipientPhoneRaw)) {
    errors.recipientPhone = 'Check their number, or leave it empty.';
  }

  const buyerName = text(input.buyerName, GIFT_CARD_NAME_MAX);
  if (buyerName.length < 2) errors.buyerName = 'Type your name.';
  else if (unsafeGiftText(buyerName)) errors.buyerName = 'Use only your name here.';
  const buyerPhone = text(input.buyerPhone, 20);
  if (!isUgandanMobile(buyerPhone)) errors.buyerPhone = 'Type your Ugandan mobile number. We text your receipt to it.';
  else if (sendTo === 'recipient' && lastNine(buyerPhone) === lastNine(recipientPhoneRaw)) {
    errors.recipientPhone = 'That is your own number. To give the card yourself, choose "Send the code to me".';
  }
  const buyerEmail = text(input.buyerEmail, 255).toLowerCase();
  if (buyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) errors.buyerEmail = 'Check your email address, or leave it empty.';

  const fromName = text(input.fromName, GIFT_CARD_FROM_MAX) || clipText(buyerName, GIFT_CARD_FROM_MAX);
  if (fromName && unsafeGiftText(fromName)) errors.fromName = 'Use only a name here (no numbers or links).';

  const message = text(input.message, GIFT_CARD_MESSAGE_MAX + 1);
  if (message.length > GIFT_CARD_MESSAGE_MAX) errors.message = `Keep the message to ${GIFT_CARD_MESSAGE_MAX} characters.`;
  else if (message && unsafeGiftText(message)) errors.message = 'For their safety the message cannot carry links, web addresses or phone numbers.';

  const deliverRaw = text(input.deliverOn, 10);
  const today = kampalaToday(now);
  let deliverOn: string | null = null;
  if (deliverRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deliverRaw) || Number.isNaN(Date.parse(`${deliverRaw}T00:00:00Z`))) errors.deliverOn = 'Pick a date, or leave it empty to send it now.';
    else if (deliverRaw < today) errors.deliverOn = 'That date has passed. Pick today or a later day.';
    else if (deliverRaw > addDaysIso(today, GIFT_CARD_SCHEDULE_MAX_DAYS)) errors.deliverOn = `Pick a date within ${GIFT_CARD_SCHEDULE_MAX_DAYS} days.`;
    else if (sendTo === 'buyer') errors.deliverOn = 'The code comes to you as soon as you pay, to give whenever you like. Leave the date empty.';
    else deliverOn = deliverRaw > today ? deliverRaw : null;
  }

  const photoRaw = typeof input.photoId === 'string' ? input.photoId.trim().toLowerCase() : '';
  if (photoRaw && !isGiftCardPhotoId(photoRaw)) errors.photo = 'Add the photo again, or remove it.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      amountUgx: amount, recipientName, recipientPhone: recipientPhoneRaw || null, sendTo, message: message || null,
      fromName, buyerName, buyerPhone, buyerEmail: buyerEmail || null, deliverOn,
      // An unknown theme is not the buyer's mistake to fix: the card simply takes the GoldPlus look.
      theme: isGiftCardTheme(input.theme) ? input.theme : 'gold',
      photoId: photoRaw || null,
    },
  };
}

// Same unambiguous alphabet as card codes (no I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The purchase's Pesapal merchant reference: GC- and 10 random symbols (50 bits), unguessable. */
export function giftCardPurchaseReference(randomIndexes: readonly number[]): string {
  if (randomIndexes.length < 10) throw new Error('giftCardPurchaseReference needs 10 random indexes');
  return `GC-${randomIndexes.slice(0, 10).map((n) => ALPHABET[((n % 32) + 32) % 32]).join('')}`;
}

export function isGiftCardPurchaseReference(value: unknown): value is string {
  return typeof value === 'string' && /^GC-[0-9A-HJKMNP-TV-Z]{10}$/.test(value);
}

/**
 * The same, for an SMS: plain x, never "•". One character outside the GSM alphabet turns the whole text into UCS-2
 * (70 characters a part instead of 160), so a two-part receipt was billed as three.
 */
export function maskPhoneForSms(phone: string | null): string {
  const d = lastNine(phone);
  return d.length === 9 ? `0${d[0]}xx xxx ${d.slice(-3)}` : '';
}

/** 0772 123 456 → 07•• ••• 456: enough for the buyer to recognise the number, not enough to read it off a screen. */
export function maskPhone(phone: string | null): string {
  const d = lastNine(phone);
  return d.length === 9 ? `0${d[0]}•• ••• ${d.slice(-3)}` : '';
}
