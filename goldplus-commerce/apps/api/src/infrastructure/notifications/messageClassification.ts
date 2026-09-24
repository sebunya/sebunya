import { MessageClass } from '../../domain/notifications/OutboundGovernancePolicy';
import { NotificationDispatchPayload } from '../../application/ports/INotificationProvider';

/**
 * Classifies an outbound message.
 *
 * The governance policy treats an operational message to staff differently from a
 * customer communication — that is the whole reason PROVIDER_DELIVERY_ENABLED and
 * CUSTOMER_COMMUNICATIONS_ENABLED exist separately — so something has to decide which
 * one a given payload is. Nothing did before: every provider applied the same gates to
 * every message, which meant either operational alerts were blocked with customer
 * communications, or customer communications rode through an operational allowance.
 *
 * Classified from the TEMPLATE, which is a first-party value chosen by the code that
 * enqueued the event, never from the payload data a caller could influence.
 *
 * FAILS CLOSED. An unrecognised template is treated as MARKETING — the most restricted
 * class — rather than as operational. A new template added without being classified here
 * must not be able to reach a customer by default; being blocked and reported is a
 * recoverable mistake, and sending marketing to someone who never consented is not.
 */

/**
 * Internal operations. Staff recipients on corporate addresses.
 *
 * Taken from the template identifiers the code actually enqueues and the renderer
 * actually knows, not from a plausible-looking naming scheme. Getting this list wrong is
 * not a cosmetic error: an unclassified template falls through to MARKETING and is
 * blocked, so a wrong list silently stops real messages.
 */
const OPERATIONAL_TEMPLATES = new Set([
  'ADMIN_ORDER_EMAIL',
  // The paid-order alert (0143): to the shop's own fulfilment phone, so that a
  // paid order is never sitting unnoticed. Never to a customer.
  'FULFILMENT_PAID_ORDER_ALERT',
  'DEALER_APPLICATION',
  'NEW_QUOTE_REQUEST',
  'FAKE_REPORT_ALERT',
  'A5_ACCEPTANCE',
  'INTERNAL_CONSENT_CANARY',
]);

/**
 * Transactional to a customer: a direct consequence of something they did.
 *
 * Still governed by CUSTOMER_COMMUNICATIONS_ENABLED — a receipt is a message to a
 * customer, and this platform's outbound gate does not exempt it.
 */
const TRANSACTIONAL_TEMPLATES = new Set([
  'ORDER_RECEIVED_UNPAID',
  'ORDER_PAYMENT_PENDING',
  'ORDER_PAYMENT_SUCCESS',
  'ORDER_PAYMENT_FAILED',
  'ORDER_PAYMENT_CANCELLED',
  'ORDER_FULFILLMENT_PROCESSING',
  'ORDER_FULFILLMENT_COMPLETED',
  // Routed outbox aliases for the two payment outcomes.
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  // Account recovery (0106). A password reset is the most transactional
  // message this system sends: the customer asked for it seconds ago and
  // cannot get back into their account without it.
  //
  // Left unclassified it fell through to MARKETING and was refused for
  // NO_CONSENT_FOR_MARKETING — so a customer locked out of their account was
  // told a link was coming and never got one, because they had not opted in to
  // receiving offers. Nobody consents to being able to reset their password.
  'PASSWORD_RESET',
  'password_reset',
  // The SMS form of the same security challenge. A reset code the customer
  // asked for seconds ago is not marketing, and must never wait on consent.
  'PASSWORD_RESET_CODE',
  // Order lifecycle messages routed as CUSTOMER_ORDER_MESSAGE, and the
  // acknowledgements a customer gets for a request they just made. All are a
  // direct consequence of the customer's own action.
  'CUSTOMER_ORDER_MESSAGE',
  'ORDER_DISPATCHED',
  'ORDER_CANCELLED_BY_SHOP',
  'SUPPORT_REQUEST_RECEIVED',
  'QUOTE_REQUEST_RECEIVED',
  'DEALER_APPLICATION_RECEIVED',
  'FAKE_REPORT_RECEIVED',
  // Phone verification (0087 identity spine). The same defect as PASSWORD_RESET
  // above, found in production on 2026-08-14: the OTP producer enqueued its
  // challenge as LOYALTY_EXPIRY_WARNING — "routed identically: SMS-first
  // customer message" — so a security challenge inherited a loyalty event's
  // identity, fell through to MARKETING, and was refused with
  // NO_CONSENT_FOR_MARKETING. Phone verification has therefore never delivered
  // a code, on a fully configured SMS provider.
  //
  // Nobody consents to being allowed to prove they own their own phone. The
  // customer asked for this code seconds ago; its lawful basis is that request,
  // not a marketing opt-in.
  'PHONE_VERIFICATION',
  // Loyalty account notices (owner, 2026-09-24; docs/loyalty-decisions.md:
  // "warnings are transactional", decision #15). They report the customer's
  // own balance: points their delivered order earned, points about to expire,
  // a redemption on their order, their tier. Left unclassified they fell to
  // MARKETING and were refused without a marketing opt-in, so points expired
  // with no warning while the sweep recorded the warning as sent. Genuine
  // promotions stay MARKETING and stay consent-gated.
  'LOYALTY_POINTS_EARNED',
  'LOYALTY_EXPIRY_WARNING',
  'LOYALTY_REDEMPTION_CONFIRMED',
  'LOYALTY_REDEMPTION_REVERSED',
  'LOYALTY_TIER_CHANGED',
]);

/**
 * Has a human decided what this template IS?
 *
 * The owner's instruction (2026-09-20) was that none of this shop's messages
 * are marketing and none should be blocked. The way to honour that is NOT to
 * stop the consent gate working — a genuine promotional send must still be
 * refused without consent, which is a legal duty under Uganda's Data Protection
 * and Privacy Act 2019 — but to make sure no real message is ever left
 * unclassified, which is what actually blocked them.
 *
 * Three were: the password reset, the phone-verification OTP, and the
 * paid-order fulfilment alert. Each was written, deployed and switched on, then
 * silently refused NO_CONSENT_FOR_MARKETING because nobody added it to a list.
 *
 * So the runtime default stays fail-closed, and the guard moves to where it can
 * be seen: a test reads every template the producers hard-code and fails the
 * build if any of them is not named in one of the three lists above. An
 * unclassified template can no longer reach production to be blocked there.
 */
export function isTemplateClassified(template: string): boolean {
  const key = (template || '').trim().toUpperCase();
  return OPERATIONAL_TEMPLATES.has(key) || TRANSACTIONAL_TEMPLATES.has(key);
}

export function classifyTemplate(template: string): MessageClass {
  // Compared case-insensitively against upper-case identifiers, so a template written
  // in the wrong case is still classified rather than silently falling through to
  // MARKETING and being blocked.
  const key = (template || '').trim().toUpperCase();
  if (OPERATIONAL_TEMPLATES.has(key)) return 'OPERATIONAL';
  if (TRANSACTIONAL_TEMPLATES.has(key)) return 'TRANSACTIONAL';
  return 'MARKETING';
}

export function classifyMessage(payload: NotificationDispatchPayload): MessageClass {
  return classifyTemplate(payload.template);
}

/** Exported for the readiness surface, so an operator can see the classification. */
export const KNOWN_TEMPLATE_CLASSES: ReadonlyArray<{ template: string; messageClass: MessageClass }> = [
  ...[...OPERATIONAL_TEMPLATES].map((template) => ({ template, messageClass: 'OPERATIONAL' as const })),
  ...[...TRANSACTIONAL_TEMPLATES].map((template) => ({ template, messageClass: 'TRANSACTIONAL' as const })),
];
