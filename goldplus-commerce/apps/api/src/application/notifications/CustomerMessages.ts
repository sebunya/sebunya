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
  | 'FAKE_REPORT_RECEIVED';

export interface CustomerMessageData {
  customerName?: string | null;
  orderNumber?: string | null;
  totalUgx?: number | null;
  reference?: string | null;
  code?: string | null;
  resetUrl?: string | null;
  expiresInMinutes?: number | null;
  points?: number | null;
  pointsExpiring?: number | null;
  expiresAt?: string | null;
  tierName?: string | null;
  balance?: number | null;
  valueUgx?: number | null;
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
      return `${SHOP_NAME}: we have your payment of ${formatUgx(d.totalUgx)} ${forOrder(d)}. Your items are being prepared. Track it: ${track}`;
    case 'ORDER_PAYMENT_FAILED':
      return `${SHOP_NAME}: the payment ${forOrder(d)} did not go through, so it is not paid. If money left your phone, it will come back. To pay again or get help, call ${phone}.`;
    case 'ORDER_PAYMENT_CANCELLED':
      return `${SHOP_NAME}: you cancelled the payment ${forOrder(d)}. Nothing was charged and the order is saved. Pay when you are ready, or call ${phone}.`;
    case 'ORDER_FULFILLMENT_PROCESSING':
      return `${SHOP_NAME}: your order${ref} is being packed at our shop. We will message you when the rider leaves. Track it: ${track}`;
    case 'ORDER_DISPATCHED':
      return `${SHOP_NAME}: your order${ref} is on its way with our rider. Please keep your phone on. Track it: ${track}`;
    case 'ORDER_FULFILLMENT_COMPLETED':
      return `${SHOP_NAME}: your order${ref} has been delivered. Thank you. If anything is wrong with it, call ${phone} and we will sort it out.`;
    case 'ORDER_CANCELLED_BY_SHOP':
      return `${SHOP_NAME}: order${ref} has been cancelled. If you paid for it, our team arranges the refund. Call ${phone} if you have not heard from us.`;
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
      return `${SHOP_NAME}: you earned ${pointsWord(d.points)}${ref ? ` on order${ref}` : ''}. Points come off your next order at checkout. See your balance: ${publicBaseUrl()}/account/loyalty`;
    case 'LOYALTY_EXPIRY_WARNING':
      return `${SHOP_NAME}: ${pointsWord(d.pointsExpiring)} of yours expire on ${dateWord(d.expiresAt)}. Use them on your next order before then: ${publicBaseUrl()}/shop`;
    case 'LOYALTY_REDEMPTION_CONFIRMED':
      return `${SHOP_NAME}: ${pointsWord(d.points)} used${d.valueUgx ? ` for ${formatUgx(d.valueUgx)} off` : ''}${ref ? ` order${ref}` : ''}. Thank you. Your balance: ${publicBaseUrl()}/account/loyalty`;
    case 'LOYALTY_REDEMPTION_REVERSED':
      return `${SHOP_NAME}: the ${pointsWord(d.points)} you used${ref ? ` on order${ref}` : ''} are back in your balance because the order did not go ahead. See your balance: ${publicBaseUrl()}/account/loyalty`;
    case 'LOYALTY_TIER_CHANGED':
      return `${SHOP_NAME}: you are now a ${d.tierName || 'new tier'} member. See what that gets you: ${publicBaseUrl()}/account/loyalty`;
    case 'SUPPORT_REQUEST_RECEIVED':
      return `${SHOP_NAME}: we have your request${d.reference ? ` (ref ${d.reference})` : ''}. Our team will call you on this number. Need us sooner? Call ${phone}.`;
    case 'QUOTE_REQUEST_RECEIVED':
      return `${SHOP_NAME}: we have your quote request${d.reference ? ` (ref ${d.reference})` : ''}. Our sales team will call you to confirm what you need and give you a price. Call ${phone} anytime.`;
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
  return `${greeting(d.customerName)}\n\n${body}\n\nReply to this message and a person at ${SHOP_NAME} will answer.`;
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
        body: `We have your payment of ${total} ${forOrder(d)}. Thank you. Your items are being prepared at our shop, and we will call or message you on the number from your order when the rider leaves.`,
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
        body: `Your order${ref} has been delivered. Thank you for shopping with ${SHOP_NAME}. If anything is wrong with it, call ${phone} and we will sort it out with you.`,
        cta: { label: 'See this order', url: track },
        tone: 'success',
      };
    case 'ORDER_CANCELLED_BY_SHOP':
      return {
        subject: `Order${ref} has been cancelled`,
        preheader: 'If you paid for it, our team arranges the refund.',
        headline: 'This order was cancelled',
        body: `Order${ref} has been cancelled. If you paid for it, our team arranges the refund and will contact you. If you have not heard from us, call ${phone}.`,
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
      return {
        subject: `You earned ${pointsWord(d.points)}`,
        preheader: 'Points come off your next order at checkout.',
        headline: `You earned ${pointsWord(d.points)}`,
        body: `You earned ${pointsWord(d.points)}${ref ? ` on order${ref}` : ''}. Points come off your next order at checkout. They expire if unused, so use them on something you need.`,
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
      return {
        subject: `You are now a ${d.tierName || 'new tier'} member`,
        preheader: 'See what that gets you.',
        headline: `Welcome to ${d.tierName || 'your new tier'}`,
        body: `You are now a ${d.tierName || 'new tier'} member at ${SHOP_NAME}. See what that gets you on your rewards page.`,
        cta: { label: 'See your rewards', url: `${publicBaseUrl()}/account/rewards` },
        tone: 'success',
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
        subject: `We have your quote request${d.reference ? ` (${d.reference})` : ''}`,
        preheader: 'Our sales team will call you with a price.',
        headline: 'We have your quote request',
        body: `Thank you. Someone from our sales team will call you to confirm what you need and give you a price. A quote is an estimate, not a final bill. If you would like to talk sooner, call ${phone}.`,
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
  'ORDER_RECEIVED_UNPAID',
  'ORDER_PAYMENT_PENDING',
  'ORDER_PAYMENT_SUCCESS',
  'ORDER_PAYMENT_FAILED',
  'ORDER_PAYMENT_CANCELLED',
  'ORDER_FULFILLMENT_PROCESSING',
  'ORDER_DISPATCHED',
  'ORDER_FULFILLMENT_COMPLETED',
  'ORDER_CANCELLED_BY_SHOP',
  'PHONE_VERIFICATION',
  'PASSWORD_RESET',
  'PASSWORD_RESET_CODE',
  'password_reset',
  'SUPPORT_REQUEST_RECEIVED',
  'QUOTE_REQUEST_RECEIVED',
  'DEALER_APPLICATION_RECEIVED',
  'FAKE_REPORT_RECEIVED',
]);
