import { gsmPlain } from '../../domain/fulfilment/PaidOrderAlert';
import { tagShopLinks } from '@goldplus/shared';

/**
 * Every message GoldPlus sends a customer, in one place, in three shapes.
 *
 * SMS is the channel that delivers today, so every template has an SMS form
 * that fits in two segments, names the order or the reason, and ends with the
 * phone number a person can call. WhatsApp is the same message with room for
 * a second line. Email is subject, preheader, headline and body.
 *
 * Rules that apply to every line here:
 *  - it describes what happened, what it means for the customer, and what to
 *    do next, in that order
 *  - it never claims money moved or did not move unless the event says so
 *  - it never promises a time we have not committed to
 *  - no system words: no status codes, no enum names, no "fulfilment stage"
 *  - plain sentences with full stops. No dashes.
 */

export type CustomerTemplate =
  | 'ORDER_RECEIVED_UNPAID'
  | 'ORDER_PAYMENT_PENDING'
  | 'ORDER_PAYMENT_SUCCESS'
  | 'ORDER_PAYMENT_FAILED'
  | 'ORDER_PAYMENT_CANCELLED'
  | 'ORDER_FULFILLMENT_PROCESSING'
  | 'ORDER_DISPATCHED'
  | 'ORDER_FULFILLMENT_COMPLETED'
  | 'ORDER_COLLECTED'
  | 'ORDER_REVIEW_REMINDER'
  | 'ORDER_PAYMENT_REMINDER'
  | 'CREDIT_ISSUED'
  | 'CREDIT_USED'
  | 'CREDIT_EXPIRING'
  | 'GIFT_CARD_RECEIVED'
  | 'GIFT_CARD_PAID'
  | 'ORDER_CANCELLED_BY_SHOP'
  | 'PHONE_VERIFICATION'
  | 'PASSWORD_RESET'
  | 'PASSWORD_RESET_CODE'
  | 'LOYALTY_POINTS_EARNED'
  | 'LOYALTY_EXPIRY_WARNING'
  | 'LOYALTY_REDEMPTION_CONFIRMED'
  | 'LOYALTY_REDEMPTION_REVERSED'
  | 'LOYALTY_TIER_CHANGED'
  | 'SUPPORT_REQUEST_RECEIVED'
  | 'QUOTE_REQUEST_RECEIVED'
  | 'DEALER_APPLICATION_RECEIVED'
  | 'FAKE_REPORT_RECEIVED'
  | 'PRODUCT_QUESTION_RECEIVED'
  | 'PRODUCT_QUESTION_ANSWERED'
  | 'BASKET_REMINDER';

export interface CustomerMessageData {
  /** 0210 BASKET_REMINDER: what the basket holds, in words ("X and 2 more items"), the basket page and where to stop reminders. */
  basketItems?: string | null;
  basketUrl?: string | null;
  preferencesUrl?: string | null;
  /** 0208: the product a question was asked about, and the shop's answer. */
  productName?: string | null;
  productUrl?: string | null;
  questionAnswer?: string | null;
  customerName?: string | null;
  orderNumber?: string | null;
  totalUgx?: number | null;
  reference?: string | null;
  /** The order's payment status when the message was written (order messages carry it). */
  paymentStatus?: string | null;
  /** 0196: what a gift card / store credit paid towards the total; the rest came by Mobile Money or card. */
  storeCreditAppliedUgx?: number | null;
  /** What is still to pay: the total less any gift card / store credit (the payment reminder asks for this). */
  amountDueUgx?: number | null;
  /** 0196 CREDIT_USED / CREDIT_EXPIRING: the card's last four, what was spent, what is left and when it ends. Never the code. */
  creditLast4?: string;
  spentUgx?: number;
  balanceUgx?: number;
  /** 0196 CREDIT_ISSUED. */
  creditKind?: 'gift_card' | 'store_credit';
  creditCode?: string;
  /** 0199 gift cards bought online: who it is from, their few words, who it is for, and where the code went. */
  fromName?: string | null;
  giftMessage?: string | null;
  recipientName?: string | null;
  recipientPhoneMasked?: string | null;
  /** True when the code goes to the buyer to hand over themselves. */
  toBuyer?: boolean;
  /** "Friday 14 November": the day a scheduled card is texted. */
  deliverOnWords?: string | null;
  code?: string | null;
  resetUrl?: string | null;
  expiresInMinutes?: number | null;
  points?: number | null;
  pointsExpiring?: number | null;
  expiresAt?: string | null;
  tierName?: string | null;
  balance?: number | null;
  valueUgx?: number | null;
  /** Bulk quote request: how many different products the list holds. */
  lineCount?: number | null;
  /** Bulk quote request: units across every line. */
  totalUnits?: number | null;
  /** Points earned: the order they vested on. Only order points can expire. */
  orderId?: string | null;
  /** Points earned for completing a mission: its customer-facing title. */
  missionTitle?: string | null;
  /** Tier change: 'down' when reversed points took a customer below their level. */
  direction?: 'up' | 'down' | null;
}

export interface EmailCopy {
  subject: string;
  preheader: string;
  headline: string;
  /** Plain sentences. The renderer escapes and lays them out. */
  body: string;
  cta: { label: string; url: string } | null;
  /** Success is green, waiting is amber, a problem is neutral. Never red. */
  tone: 'success' | 'wait' | 'neutral';
}

const SHOP_NAME = 'GoldPlus';

/** Public origin for links in messages. */
export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.PUBLIC_SITE_URL || 'https://www.shopgoldplus.com').replace(/\/$/, '');
}

/** The number a person answers, as customers dial it. */
export function supportPhoneDisplay(): string {
  const raw = (process.env.SUPPORT_PHONE_DISPLAY || '').trim();
  return raw || '0705 004545';
}

export function trackOrderUrl(orderNumber: string | null | undefined): string {
  const base = `${publicBaseUrl()}/track-order`;
  return orderNumber ? `${base}?reference=${encodeURIComponent(orderNumber)}` : base;
}

/** "Rate what you bought" for a delivered order: the review page with the reference filled in.
 *  The shopper still proves the order with the phone or email they used, as on /track-order. */
export function reviewOrderUrl(orderNumber: string | null | undefined): string {
  const base = `${publicBaseUrl()}/review`;
  return orderNumber ? `${base}?reference=${encodeURIComponent(orderNumber)}` : base;
}

/** The page where a gift card is opened and scratched; the code travels in the #fragment, never to a server. */
export function giftCardOpenUrl(code: string | null | undefined): string {
  return `${publicBaseUrl()}/gift-card/open${code ? `#${code}` : ''}`;
}

/** Where a buyer follows their gift card purchase (the GC- reference is unguessable and shows nothing in full). */
export function giftCardStatusUrl(reference: string | null | undefined): string {
  return `${publicBaseUrl()}/gift-card/bought${reference ? `?ref=${encodeURIComponent(reference)}` : ''}`;
}

/** What is still to pay on an order: the amount due when the writer sent it, else the total. */
const dueUgx = (d: CustomerMessageData): number =>
  typeof d.amountDueUgx === 'number' && Number.isFinite(d.amountDueUgx) ? d.amountDueUgx : Number(d.totalUgx);

export function formatUgx(amount: number | null | undefined): string {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  return `UGX ${n.toLocaleString('en-UG')}`;
}

function firstName(name: string | null | undefined): string {
  const n = String(name || '').trim();
  if (!n) return '';
  return n.split(/\s+/)[0];
}

function greeting(name: string | null | undefined): string {
  const f = firstName(name);
  return f ? `Hello ${f},` : 'Hello,';
}

function orderRef(d: CustomerMessageData): string {
  return d.orderNumber ? ` ${d.orderNumber}` : '';
}

/** "for order GP-…", or "for this order" when the number is not known. */
function forOrder(d: CustomerMessageData): string {
  return d.orderNumber ? `for order ${d.orderNumber}` : 'for this order';
}

function pointsWord(n: number | null | undefined): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return `${v.toLocaleString('en-UG')} point${v === 1 ? '' : 's'}`;
}

/** " for 12 products" on a bulk quote request; nothing when the count is not known. */
function productsWord(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0);
  if (v < 1) return '';
  return ` for ${v.toLocaleString('en-UG')} product${v === 1 ? '' : 's'}`;
}

function dateWord(iso: string | null | undefined): string {
  if (!iso) return 'soon';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'soon';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ------------------------------------------------------------------------ */
/* SMS                                                                        */
/* ------------------------------------------------------------------------ */

/**
 * The SMS form. Returns null for a template that has no SMS form, so the
 * adapter refuses instead of sending the template's name as the text.
 */
/**
 * 0196: how an order was paid when a gift card / store credit paid some or all of it. Empty when it did not, so
 * every other payment message reads exactly as before.
 */
/**
 * 0196: on a cancelled order, where the gift card / store credit money went. It goes back to the card by itself at
 * the moment of cancelling (ReleaseCancelledOrderHoldsUseCase), so "our team arranges the refund" is true only for
 * what Mobile Money or card paid. Empty when no card was used.
 */
export function creditBackOnCancel(d: CustomerMessageData): string {
  const credit = Math.max(0, Number(d.storeCreditAppliedUgx ?? 0));
  if (!credit) return '';
  const spent = ['paid', 'reversed', 'refunded', 'partially_refunded'].includes(String(d.paymentStatus ?? ''));
  return spent
    ? ` The ${formatUgx(credit)} your gift card or store credit paid is back on the card already.`
    : ` The ${formatUgx(credit)} reserved on your gift card or store credit is free to use again.`;
}

/** Who refunds what on a cancelled order: the team only refunds what Mobile Money or card paid. */
function refundLine(d: CustomerMessageData, email: boolean): string {
  const credit = Math.max(0, Number(d.storeCreditAppliedUgx ?? 0));
  const contact = email ? ' and will contact you' : '';
  if (!credit) return `If you paid for it, our team arranges the refund${contact}.`;
  const rest = Math.max(0, Number(d.totalUgx ?? 0) - credit);
  if (rest <= 0) return 'Nothing else was paid, so there is nothing more to refund.';
  return `If you paid the other ${formatUgx(rest)} by Mobile Money or card, our team arranges that refund${contact}.`;
}

/** The cancellation email's refund line (the designed template's {{refund_update}}) when a gift card was used. */
export function cancelRefundUpdate(d: CustomerMessageData): string | null {
  const back = creditBackOnCancel(d);
  return back ? `${back.trim()} ${refundLine(d, true)}` : null;
}

export function paidWithSplit(d: CustomerMessageData): string {
  const credit = Math.max(0, Number(d.storeCreditAppliedUgx ?? 0));
  if (!credit || !d.totalUgx) return '';
  const rest = Math.max(0, d.totalUgx - credit);
  return rest > 0
    ? ` (gift card or store credit ${formatUgx(credit)} + Mobile Money or card ${formatUgx(rest)})`
    : ' (paid in full with your gift card or store credit)';
}

export function smsText(template: string, d: CustomerMessageData = {}): string | null {
  const raw = smsTextRaw(template, d);
  if (!raw) return null;
  // "GoldPlus: We have your payment", not "GoldPlus: we have your payment".
  return raw.replace(/^GoldPlus: ([a-z])/, (_, c: string) => `GoldPlus: ${c.toUpperCase()}`);
}

function smsTextRaw(template: string, d: CustomerMessageData = {}): string | null {
  const phone = supportPhoneDisplay();
  const ref = orderRef(d);
  const track = trackOrderUrl(d.orderNumber);
  switch (template as CustomerTemplate) {
    case 'ORDER_RECEIVED_UNPAID':
      return `${SHOP_NAME}: we have your order${ref} for ${formatUgx(d.totalUgx)}. It is not paid yet. Our team will call you to confirm it. Questions? Call ${phone}.`;
    case 'ORDER_PAYMENT_PENDING':
      return `${SHOP_NAME}: your payment ${forOrder(d)} has started but has not cleared yet. Please do not pay again. We will confirm it shortly. Call ${phone} if you are unsure.`;
    case 'ORDER_PAYMENT_SUCCESS':
      return `${SHOP_NAME}: we have your payment of ${formatUgx(d.totalUgx)}${paidWithSplit(d)} ${forOrder(d)}. Your items are being prepared. Track it: ${track}`;
    case 'ORDER_PAYMENT_FAILED':
      return `${SHOP_NAME}: the payment ${forOrder(d)} did not go through, so it is not paid. If money left your phone, it will come back. To pay again or get help, call ${phone}.`;
    case 'ORDER_PAYMENT_CANCELLED':
      return `${SHOP_NAME}: you cancelled the payment ${forOrder(d)}. Nothing was charged and the order is saved. Pay when you are ready, or call ${phone}.`;
    case 'ORDER_FULFILLMENT_PROCESSING':
      return `${SHOP_NAME}: your order${ref} is being packed at our shop. We will message you when the rider leaves. Track it: ${track}`;
    case 'ORDER_DISPATCHED':
      return `${SHOP_NAME}: your order${ref} is on its way with our rider. Please keep your phone on. Track it: ${track}`;
    case 'ORDER_FULFILLMENT_COMPLETED':
      // The one moment to ask for a review: the goods have just arrived. Same text, one link more.
      return `${SHOP_NAME}: your order${ref} has been delivered. Thank you. How was it? Rate it in a minute: ${reviewOrderUrl(d.orderNumber)} If anything is wrong, call ${phone}.`;
    case 'ORDER_COLLECTED':
      // A counter collection: "delivered" would not be true, the review ask is the same.
      return `${SHOP_NAME}: order${ref} is complete. Thank you for shopping with us. How was it? Rate it in a minute: ${reviewOrderUrl(d.orderNumber)} If anything is wrong, call ${phone}.`;
    case 'ORDER_PAYMENT_REMINDER':
      // Sent once, about an hour after an online order was placed and never paid, never while a payment is clearing.
      // The amount still to pay: a gift card that covered part of it is not asked for again (2026-10-22).
      return `${SHOP_NAME}: your order${ref} for ${formatUgx(dueUgx(d))} is saved but not paid yet. Pay with Mobile Money or card here: ${track} If you already paid, do not pay again; call ${phone}. We will not remind you again.`;
    case 'CREDIT_USED':
      // To the card's holder when someone else's order spent it (a gift): what went, and what is left.
      return `${SHOP_NAME}: ${formatUgx(d.spentUgx)} from your ${d.creditKind === 'gift_card' ? 'gift card' : 'store credit'} ending ${d.creditLast4} paid for order ${d.orderNumber}. Left on it: ${formatUgx(d.balanceUgx)}. Not you? Call ${phone}.`;
    case 'CREDIT_EXPIRING':
      return `${SHOP_NAME}: your ${d.creditKind === 'gift_card' ? 'gift card' : 'store credit'} ending ${d.creditLast4} has ${formatUgx(d.balanceUgx)} left and ends on ${d.expiresAt}. Use it at checkout on shopgoldplus.com or in the shop. Questions? Call ${phone}.`;
    case 'CREDIT_ISSUED':
      // 0196: the code is the money. Said plainly, once, to the number staff typed at issue.
      return `${SHOP_NAME}: you have a ${d.creditKind === 'gift_card' ? 'gift card' : 'store credit'} of ${formatUgx(d.valueUgx)}. Code: ${d.creditCode}. Use it at checkout on shopgoldplus.com or in the shop. Anyone with this code can spend it, so keep it safe. Questions? Call ${phone}.`;
    case 'GIFT_CARD_RECEIVED':
      // 0199: a gift card bought online. The code is the money, said once, to whoever holds the card.
      // The link opens the card (scratch to reveal); the code is in the text too, for a phone without internet.
      // The code rides the link's #fragment, which a browser never sends to any server.
      if (d.toBuyer) {
        return `${SHOP_NAME}: your gift card of ${formatUgx(d.valueUgx)} for ${gsmPlain(String(d.recipientName ?? ''))} is ready. Send them this link to open it: ${giftCardOpenUrl(d.creditCode)} Code: ${d.creditCode}. Anyone with the code can spend it, so share it only with them.`;
      }
      // The note (up to 160 characters, emoji and all) is on the card itself, exactly as written; the text only says
      // there is one, so its length stays the same whatever the buyer wrote and nothing of it is cut or stripped.
      return `${SHOP_NAME}: ${gsmPlain(String(d.fromName ?? '')) || 'Someone'} sent you a gift card of ${formatUgx(d.valueUgx)}${String(d.giftMessage ?? '').trim() ? ', with a note for you on the card.' : '.'} Open it: ${giftCardOpenUrl(d.creditCode)} Code: ${d.creditCode}. Spend it on shopgoldplus.com or in our shop. Keep it safe: anyone with the code can spend it.`;
    case 'GIFT_CARD_PAID':
      // 0199: to the buyer when the code goes to someone else. Never the code.
      return d.deliverOnWords
        ? `${SHOP_NAME}: payment received, thank you. Your gift card of ${formatUgx(d.valueUgx)} for ${d.recipientName} will be texted to ${d.recipientPhoneMasked} on ${d.deliverOnWords} morning. Follow it: ${giftCardStatusUrl(d.reference)} Questions? Call ${phone}.`
        : `${SHOP_NAME}: payment received, thank you. Your gift card of ${formatUgx(d.valueUgx)} for ${d.recipientName} is being texted to ${d.recipientPhoneMasked} now. Follow it: ${giftCardStatusUrl(d.reference)} If it does not arrive, call ${phone}.`;
    case 'ORDER_REVIEW_REMINDER':
      // Sent once, a few days after delivery or collection, only when nothing on the order is rated.
      return `${SHOP_NAME}: how is what you bought on order${ref}? A rating helps the next shopper choose: ${reviewOrderUrl(d.orderNumber)} We will not ask again. If anything is wrong, call ${phone}.`;
    case 'ORDER_CANCELLED_BY_SHOP':
      return `${SHOP_NAME}: order${ref} has been cancelled.${creditBackOnCancel(d)} ${refundLine(d, false)} Call ${phone} if you have not heard from us.`;
    case 'PHONE_VERIFICATION':
      return d.code
        ? `Your ${SHOP_NAME} code is ${d.code}. It expires in ${d.expiresInMinutes ?? 10} minutes. Never share this code with anyone, including us.`
        : null;
    case 'PASSWORD_RESET':
      return d.resetUrl
        ? `${SHOP_NAME}: set a new password here: ${d.resetUrl} The link works once and expires in ${d.expiresInMinutes ?? 60} minutes. If you did not ask for this, ignore it.`
        : null;
    case 'PASSWORD_RESET_CODE':
      return d.code
        ? `${SHOP_NAME}: your password reset code is ${d.code}. It works once and expires in ${d.expiresInMinutes ?? 10} minutes. If you did not ask for it, ignore this message and nothing changes. Never share this code.`
        : null;
    case 'LOYALTY_POINTS_EARNED':
      if (d.missionTitle) {
        return `${SHOP_NAME}: you completed ${d.missionTitle} and earned a bonus of ${pointsWord(d.points)}. Points come off your next order at checkout. See your balance: ${publicBaseUrl()}/account/loyalty`;
      }
      return `${SHOP_NAME}: you earned ${pointsWord(d.points)}${ref ? ` on order${ref}` : ''}. Points come off your next order at checkout. See your balance: ${publicBaseUrl()}/account/loyalty`;
    case 'LOYALTY_EXPIRY_WARNING':
      return `${SHOP_NAME}: ${pointsWord(d.pointsExpiring)} of yours expire on ${dateWord(d.expiresAt)}. Use them on your next order before then: ${publicBaseUrl()}/shop`;
    case 'LOYALTY_REDEMPTION_CONFIRMED':
      return `${SHOP_NAME}: ${pointsWord(d.points)} used${d.valueUgx ? ` for ${formatUgx(d.valueUgx)} off` : ''}${ref ? ` order${ref}` : ''}. Thank you. Your balance: ${publicBaseUrl()}/account/loyalty`;
    case 'LOYALTY_REDEMPTION_REVERSED':
      return `${SHOP_NAME}: the ${pointsWord(d.points)} you used${ref ? ` on order${ref}` : ''} are back in your balance because the order did not go ahead. See your balance: ${publicBaseUrl()}/account/loyalty`;
    case 'LOYALTY_TIER_CHANGED':
      if (d.direction === 'down') {
        // No cause is claimed: a level goes down when reversed points stop
        // counting OR when the shop raises a threshold, and only the customer's
        // points page shows which.
        return `${SHOP_NAME}: your membership level is now ${d.tierName || 'updated'}. Your level follows the lifetime points on your account. See how yours add up: ${publicBaseUrl()}/account/loyalty`;
      }
      return `${SHOP_NAME}: you are now a ${d.tierName || 'new tier'} member. See what that gets you: ${publicBaseUrl()}/account/loyalty`;
    case 'PRODUCT_QUESTION_RECEIVED':
      return `${SHOP_NAME}: we have your question about ${d.productName ?? 'the product'}. A person at the shop will answer it and send the answer to this number. Need it sooner? Call ${phone}.`;
    case 'PRODUCT_QUESTION_ANSWERED':
      // The answer itself travels in the SMS, so the customer never has to open a page to get it.
      return `${SHOP_NAME}: about ${d.productName ?? 'the product'} you asked us. Our answer: ${String(d.questionAnswer ?? '').slice(0, 320)}${d.productUrl ? ` See it: ${d.productUrl}` : ''} Any other question, call ${phone}.`;
    case 'BASKET_REMINDER':
      // Marketing, by the customer's own tick: short, names what they left, and says where to stop these.
      return `${SHOP_NAME}: you left ${d.basketItems ?? 'some items'} in your basket. It is still here: ${d.basketUrl ?? `${publicBaseUrl()}/cart`} To stop basket reminders: ${d.preferencesUrl ?? `${publicBaseUrl()}/account/preferences`}`;
    case 'SUPPORT_REQUEST_RECEIVED':
      return `${SHOP_NAME}: we have your request${d.reference ? ` (ref ${d.reference})` : ''}. Our team will call you on this number. Need us sooner? Call ${phone}.`;
    case 'QUOTE_REQUEST_RECEIVED':
      // One template for the bulk page and the older quote form: "request" fits both.
      return `${SHOP_NAME}: we have your request${d.reference ? ` (ref ${d.reference})` : ''}${productsWord(d.lineCount)}. Our sales team will call you to confirm what you need, the total and the delivery date. Call ${phone} anytime.`;
    case 'DEALER_APPLICATION_RECEIVED':
      return `${SHOP_NAME}: we have your dealer application${d.reference ? ` (ref ${d.reference})` : ''}. Our team will review it and call you. Questions? Call ${phone}.`;
    case 'FAKE_REPORT_RECEIVED':
      return `${SHOP_NAME}: thank you for reporting a suspected fake${d.reference ? ` (ref ${d.reference})` : ''}. We check every report. We may call you for a detail or two. Questions? Call ${phone}.`;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------ */
/* WhatsApp                                                                   */
/* ------------------------------------------------------------------------ */

export function whatsappText(template: string, d: CustomerMessageData = {}): string | null {
  const sms = smsText(template, d);
  if (!sms) return null;
  // WhatsApp has room for a greeting and a reply prompt; the substance is the
  // same sentence the SMS carries, so the two channels never disagree.
  const body = sms.replace(`${SHOP_NAME}: `, '');
  // Its shop links say WhatsApp (shared/links/shopLinkTag); the SMS adapter tags its own as SMS.
  return tagShopLinks(`${greeting(d.customerName)}\n\n${body}\n\nReply to this message and a person at ${SHOP_NAME} will answer.`, 'w');
}

/* ------------------------------------------------------------------------ */
/* Email                                                                      */
/* ------------------------------------------------------------------------ */

export function emailCopy(template: string, d: CustomerMessageData = {}): EmailCopy | null {
  const phone = supportPhoneDisplay();
  const ref = orderRef(d);
  const track = trackOrderUrl(d.orderNumber);
  const total = formatUgx(d.totalUgx);
  switch (template as CustomerTemplate) {
    case 'ORDER_RECEIVED_UNPAID':
      return {
        subject: `We have your ${SHOP_NAME} order${ref}`,
        preheader: 'It is not paid yet. Our team will call you to confirm it.',
        headline: 'We have your order',
        body: `Thank you. We have saved order${ref} for ${total}. It is not paid yet. Our team will call you on the number from your order to confirm the details and the total, and to arrange payment. If you would rather reach us first, call ${phone}.`,
        cta: { label: 'Track this order', url: track },
        tone: 'wait',
      };
    case 'ORDER_PAYMENT_PENDING':
      return {
        subject: `Your payment ${forOrder(d)} has not cleared yet`,
        preheader: 'Please do not pay again. We will confirm it shortly.',
        headline: 'We are waiting for your payment to clear',
        body: `Your payment ${forOrder(d)} has started but has not cleared yet. If you approved it on your phone, it usually clears within a few minutes. Please do not pay again, as that could charge you twice. We will confirm it and let you know. If you are unsure, call ${phone}.`,
        cta: { label: 'Check this order', url: track },
        tone: 'wait',
      };
    case 'ORDER_PAYMENT_SUCCESS':
      return {
        subject: `Payment received for your ${SHOP_NAME} order${ref}`,
        preheader: 'We have your payment. Your items are being prepared.',
        headline: 'Payment received',
        body: `We have your payment of ${total}${paidWithSplit(d)} ${forOrder(d)}. Thank you. Your items are being prepared at our shop, and we will call or message you on the number from your order when the rider leaves.`,
        cta: { label: 'Track this order', url: track },
        tone: 'success',
      };
    case 'ORDER_PAYMENT_FAILED':
      return {
        subject: `Your payment ${forOrder(d)} did not go through`,
        preheader: 'The order is saved. You can pay again when you are ready.',
        headline: 'Payment did not go through',
        body: `The payment ${forOrder(d)} did not go through, so the order is not paid. If money left your phone or card, it will come back. Tell us if it does not. Your order is saved, and paying again will not create a second one. If you would like help paying, call ${phone}.`,
        cta: { label: 'Try payment again', url: `${publicBaseUrl()}/checkout` },
        tone: 'neutral',
      };
    case 'ORDER_PAYMENT_CANCELLED':
      return {
        subject: `You cancelled the payment ${forOrder(d)}`,
        preheader: 'Nothing was charged. The order is saved.',
        headline: 'Payment cancelled',
        body: `You cancelled before paying ${forOrder(d)}. Nothing was charged, and the order is saved. Pay for it when you are ready. It will not create a second order. If you need a hand, call ${phone}.`,
        cta: { label: 'Pay for this order', url: `${publicBaseUrl()}/checkout` },
        tone: 'neutral',
      };
    case 'ORDER_FULFILLMENT_PROCESSING':
      return {
        subject: `Your order${ref} is being prepared`,
        preheader: 'We will message you when the rider leaves.',
        headline: 'Your order is being packed',
        body: `Your order${ref} is being packed at our shop. We will call or message you on the number from your order when the rider leaves.`,
        cta: { label: 'Track this order', url: track },
        tone: 'wait',
      };
    case 'ORDER_DISPATCHED':
      return {
        subject: `Your order${ref} is on its way`,
        preheader: 'Please keep your phone on for the rider.',
        headline: 'On its way',
        body: `Your order${ref} has left our shop with our rider. Please keep your phone on, as the rider will call when they are close.`,
        cta: { label: 'Track this order', url: track },
        tone: 'success',
      };
    case 'ORDER_FULFILLMENT_COMPLETED':
      return {
        subject: `Your order${ref} has been delivered`,
        preheader: 'Thank you for shopping with GoldPlus.',
        headline: 'Delivered',
        body: `Your order${ref} has been delivered. Thank you for shopping with ${SHOP_NAME}. If you have a minute, rate what you bought from the order page; it helps the next shopper choose. If anything is wrong with it, call ${phone} and we will sort it out with you.`,
        cta: { label: 'See this order', url: track },
        tone: 'success',
      };
    case 'ORDER_COLLECTED':
      return {
        subject: `Your order${ref} is complete`,
        preheader: 'Thank you for shopping with GoldPlus.',
        headline: 'Order complete',
        body: `Your order${ref} is complete. Thank you for shopping with ${SHOP_NAME}. If you have a minute, rate what you bought; it helps the next shopper choose. If anything is wrong with it, call ${phone} and we will sort it out with you.`,
        cta: { label: 'Rate what you bought', url: reviewOrderUrl(d.orderNumber) },
        tone: 'success',
      };
    case 'GIFT_CARD_PAID':
      return {
        subject: `Your ${SHOP_NAME} gift card for ${d.recipientName} is paid`,
        preheader: d.deliverOnWords ? `It will be texted to them on ${d.deliverOnWords}.` : 'Its code is being texted to them now.',
        headline: 'Gift card paid',
        body: `Thank you. We have your payment of ${formatUgx(d.valueUgx)} for a gift card for ${d.recipientName}. ${d.deliverOnWords ? `Its code will be texted to ${d.recipientPhoneMasked} on ${d.deliverOnWords} morning.` : `Its code is being texted to ${d.recipientPhoneMasked} now.`} Your reference is ${d.reference}. If they do not receive it, call ${phone} and we will help.`,
        cta: { label: 'Follow your gift card', url: giftCardStatusUrl(d.reference) },
        tone: 'success',
      };
    case 'ORDER_PAYMENT_REMINDER':
      return {
        subject: `Your ${SHOP_NAME} order${ref} is saved but not paid`,
        preheader: 'Pay with Mobile Money or card when you are ready. This is the only reminder.',
        headline: 'Your order is waiting for payment',
        body: `You placed order${ref} for ${formatUgx(dueUgx(d))}${Number(d.storeCreditAppliedUgx) > 0 ? ' still to pay after your gift card' : ''}, and it has not been paid yet, so we have not started preparing it. You can pay with Mobile Money or card from the link below, using the phone number or email from your order. If you already paid and it has not cleared, please do not pay again: call ${phone} and we will check. This is the only reminder we send.`,
        cta: { label: 'Pay for this order', url: track },
        tone: 'wait',
      };
    case 'ORDER_REVIEW_REMINDER':
      return {
        subject: `How is what you bought on order${ref}?`,
        preheader: 'A rating takes a minute. We will not ask again.',
        headline: 'How is it working?',
        body: `You have had order${ref} for a few days now. If you have a minute, rate what you bought; it helps the next shopper choose. This is the only reminder we send. If anything is wrong with it, call ${phone} and we will sort it out with you.`,
        cta: { label: 'Rate what you bought', url: reviewOrderUrl(d.orderNumber) },
        tone: 'neutral',
      };
    case 'ORDER_CANCELLED_BY_SHOP':
      return {
        subject: `Order${ref} has been cancelled`,
        preheader: 'If you paid for it, our team arranges the refund.',
        headline: 'This order was cancelled',
        body: `Order${ref} has been cancelled.${creditBackOnCancel(d)} ${refundLine(d, true)} If you have not heard from us, call ${phone}.`,
        cta: { label: 'Back to the shop', url: `${publicBaseUrl()}/shop` },
        tone: 'neutral',
      };
    case 'PASSWORD_RESET':
      return d.resetUrl
        ? {
            subject: `Set a new ${SHOP_NAME} password`,
            preheader: 'The link works once and expires in an hour.',
            headline: 'Set a new password',
            body: `Use the button below to choose a new password. The link works once and expires in ${d.expiresInMinutes ?? 60} minutes. Setting a new password signs you out everywhere else. If you did not ask for this, you can ignore this email and your password stays as it is.`,
            cta: { label: 'Set a new password', url: d.resetUrl },
            tone: 'neutral',
          }
        : null;
    case 'LOYALTY_POINTS_EARNED':
      if (d.missionTitle) {
        return {
          subject: `You completed ${d.missionTitle}`,
          preheader: `A bonus of ${pointsWord(d.points)} is in your balance.`,
          headline: `You completed ${d.missionTitle}`,
          body: `You completed ${d.missionTitle} and earned a bonus of ${pointsWord(d.points)}. Points come off your next order at checkout, and they count toward your membership level.`,
          cta: { label: 'See your rewards', url: `${publicBaseUrl()}/account/rewards` },
          tone: 'success',
        };
      }
      return {
        subject: `You earned ${pointsWord(d.points)}`,
        preheader: 'Points come off your next order at checkout.',
        headline: `You earned ${pointsWord(d.points)}`,
        // Only order points expire (loyalty terms §4); a referral or other
        // reward never does, so it is never told to hurry.
        body: `You earned ${pointsWord(d.points)}${ref ? ` on order${ref}` : ''}. Points come off your next order at checkout.${d.orderId ? ' They expire if unused, so use them on something you need.' : ''}`,
        cta: { label: 'See your points', url: `${publicBaseUrl()}/account/loyalty` },
        tone: 'success',
      };
    case 'LOYALTY_EXPIRY_WARNING':
      return {
        subject: `${pointsWord(d.pointsExpiring)} expire on ${dateWord(d.expiresAt)}`,
        preheader: 'Use them on your next order before then.',
        headline: 'Some of your points are about to expire',
        body: `${pointsWord(d.pointsExpiring)} of yours expire on ${dateWord(d.expiresAt)}. Use them on your next order before then and they come straight off the total at checkout.`,
        cta: { label: 'Shop now', url: `${publicBaseUrl()}/shop` },
        tone: 'wait',
      };
    case 'LOYALTY_REDEMPTION_CONFIRMED':
      return {
        subject: `${pointsWord(d.points)} used${ref ? ` on order${ref}` : ''}`,
        preheader: 'Thank you.',
        headline: 'Points used',
        body: `You used ${pointsWord(d.points)}${d.valueUgx ? ` for ${formatUgx(d.valueUgx)} off` : ''}${ref ? ` order${ref}` : ''}. Thank you.`,
        cta: { label: 'See your points', url: `${publicBaseUrl()}/account/loyalty` },
        tone: 'success',
      };
    case 'LOYALTY_REDEMPTION_REVERSED':
      return {
        subject: `Your ${pointsWord(d.points)} are back`,
        preheader: 'The order did not go ahead, so the points were returned.',
        headline: 'Your points are back',
        body: `The ${pointsWord(d.points)} you used${ref ? ` on order${ref}` : ''} are back in your balance, because that order did not go ahead.`,
        cta: { label: 'See your points', url: `${publicBaseUrl()}/account/loyalty` },
        tone: 'neutral',
      };
    case 'LOYALTY_TIER_CHANGED':
      if (d.direction === 'down') {
        return {
          subject: `Your membership level is now ${d.tierName || 'updated'}`,
          preheader: 'Your level follows the lifetime points on your account.',
          headline: `Your level is now ${d.tierName || 'updated'}`,
          body: `Your membership level at ${SHOP_NAME} is now ${d.tierName || 'updated'}. Your level follows the lifetime points on your account; your points page shows how yours add up. Spending points never lowers your level, and every point you earn from here counts toward the next one.`,
          cta: { label: 'See your points', url: `${publicBaseUrl()}/account/loyalty` },
          tone: 'neutral',
        };
      }
      return {
        subject: `You are now a ${d.tierName || 'new tier'} member`,
        preheader: 'See what that gets you.',
        headline: `Welcome to ${d.tierName || 'your new tier'}`,
        body: `You are now a ${d.tierName || 'new tier'} member at ${SHOP_NAME}. See what that gets you on your rewards page.`,
        cta: { label: 'See your rewards', url: `${publicBaseUrl()}/account/rewards` },
        tone: 'success',
      };
    case 'PRODUCT_QUESTION_RECEIVED':
      return {
        subject: `We have your question about ${d.productName ?? 'the product'}`,
        preheader: 'A person at the shop will answer it.',
        headline: 'We have your question',
        body: `Thank you. We have your question about ${d.productName ?? 'the product'}. A person at the shop will answer it and send the answer to you. If you need it sooner, call ${phone}.`,
        cta: d.productUrl ? { label: 'See the product', url: d.productUrl } : null,
        tone: 'neutral',
      };
    case 'PRODUCT_QUESTION_ANSWERED':
      return {
        subject: `Our answer about ${d.productName ?? 'the product'}`,
        preheader: String(d.questionAnswer ?? '').slice(0, 120),
        headline: 'Our answer to your question',
        body: `You asked us about ${d.productName ?? 'the product'}. Our answer: ${String(d.questionAnswer ?? '')} Any other question, call ${phone}.`,
        cta: d.productUrl ? { label: 'See the product', url: d.productUrl } : null,
        tone: 'neutral',
      };
    case 'BASKET_REMINDER':
      return {
        subject: 'Your GoldPlus basket is still here',
        preheader: `You left ${d.basketItems ?? 'some items'} in your basket.`,
        headline: 'Still thinking it over?',
        body: `You left ${d.basketItems ?? 'some items'} in your basket. It is saved and ready whenever you are. You asked us for basket reminders; switch them off any time in My preferences: ${d.preferencesUrl ?? `${publicBaseUrl()}/account/preferences`}`,
        cta: { label: 'Open my basket', url: d.basketUrl ?? `${publicBaseUrl()}/cart` },
        tone: 'neutral',
      };
    case 'SUPPORT_REQUEST_RECEIVED':
      return {
        subject: `We have your request${d.reference ? ` (${d.reference})` : ''}`,
        preheader: 'Our team will call you on the number you gave.',
        headline: 'We have your request',
        body: `Thank you. We have your request${d.reference ? `, reference ${d.reference}` : ''}. Our team will call you on the number you gave. If you need us sooner, call ${phone}.`,
        cta: null,
        tone: 'neutral',
      };
    case 'QUOTE_REQUEST_RECEIVED':
      return {
        subject: `We have your request${d.reference ? ` (${d.reference})` : ''}`,
        preheader: 'Our sales team will call you to confirm the total and delivery.',
        headline: 'We have your request',
        body: `Thank you. Someone from our sales team will call you to confirm what you need, the total and the delivery date. Nothing is charged until you agree. If you would like to talk sooner, call ${phone}.`,
        cta: null,
        tone: 'neutral',
      };
    case 'DEALER_APPLICATION_RECEIVED':
      return {
        subject: `We have your dealer application${d.reference ? ` (${d.reference})` : ''}`,
        preheader: 'Our team will review it and call you.',
        headline: 'We have your application',
        body: `Thank you for applying to be a ${SHOP_NAME} dealer. Our team will review your details and call you on the number you gave. If you have a question in the meantime, call ${phone}.`,
        cta: null,
        tone: 'neutral',
      };
    case 'FAKE_REPORT_RECEIVED':
      return {
        subject: 'Thank you for your report',
        preheader: 'We check every report of a suspected fake.',
        headline: 'Thank you for your report',
        body: `We have your report of a suspected fake${d.reference ? `, reference ${d.reference}` : ''}. We check every one. We may call you to confirm a detail or two. Reports like yours are how we keep fakes out of Kampala.`,
        cta: null,
        tone: 'neutral',
      };
    case 'PHONE_VERIFICATION':
    case 'PASSWORD_RESET_CODE':
      // A code proves control of a phone; it has no email form.
      return null;
    default:
      return null;
  }
}

/** Templates that are transactional by nature: about the customer's own order, account or request. */
export const CUSTOMER_TRANSACTIONAL_TEMPLATES: readonly string[] = Object.freeze([
  // 0196: about money the customer holds with us (never marketing): its code once, its use, its expiry.
  'CREDIT_ISSUED',
  'CREDIT_USED',
  'CREDIT_EXPIRING',
  // 0199: a gift card bought online: its code to whoever holds it, and the buyer's receipt.
  'GIFT_CARD_RECEIVED',
  'GIFT_CARD_PAID',
  'ORDER_RECEIVED_UNPAID',
  'ORDER_PAYMENT_PENDING',
  'ORDER_PAYMENT_SUCCESS',
  'ORDER_PAYMENT_FAILED',
  'ORDER_PAYMENT_CANCELLED',
  'ORDER_FULFILLMENT_PROCESSING',
  'ORDER_DISPATCHED',
  'ORDER_FULFILLMENT_COMPLETED',
  'ORDER_COLLECTED',
  'ORDER_REVIEW_REMINDER',
  'ORDER_PAYMENT_REMINDER',
  'ORDER_CANCELLED_BY_SHOP',
  'PHONE_VERIFICATION',
  'PASSWORD_RESET',
  'PASSWORD_RESET_CODE',
  'password_reset',
  'SUPPORT_REQUEST_RECEIVED',
  'QUOTE_REQUEST_RECEIVED',
  'DEALER_APPLICATION_RECEIVED',
  'FAKE_REPORT_RECEIVED',
  'PRODUCT_QUESTION_RECEIVED',
  'PRODUCT_QUESTION_ANSWERED',
]);
