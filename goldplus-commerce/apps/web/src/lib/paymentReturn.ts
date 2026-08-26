/**
 * What to tell a customer coming back from PesaPal.
 *
 * The API redirects here with `status=<settlement kind>` (see the PesaPal
 * callback route in commerce.ts). The page used to test only for `success`
 * and render EVERYTHING else as "Payment Verification Failed — no funds have
 * been charged", with a "Retry Checkout" button. That sentence was false for
 * a customer whose MTN wallet had already been debited (ALREADY_SETTLED) and
 * for one whose debit was still in flight (PENDING) — and the button invited
 * them to pay twice.
 *
 * Every kind is spelled out below. Nothing here may claim money did or did
 * not move unless the settlement says so.
 */

export type PaymentReturnKind =
  | 'success'
  | 'pending'
  | 'review_required'
  | 'already_settled'
  | 'failed'
  | 'unknown_attempt';

export interface PaymentReturnCopy {
  kind: PaymentReturnKind;
  /** Visual tone; `wait` is amber, never red — waiting is not failure. */
  tone: 'success' | 'wait' | 'failed';
  title: string;
  /** The one sentence about the customer's money. */
  money: string;
  /** What happens next, and what they should (or should not) do. */
  next: string;
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
  /** Offer WhatsApp as the escape hatch. */
  offerHelp: boolean;
}

/**
 * Recover the customer's order number from the PesaPal merchant reference.
 * The reference is `GP-<orderNumber>-<shortId>` and the order number is itself
 * `GP-YYYYMM-XXXX`, so the middle is what the tracking page asks for.
 */
export function orderNumberFromMerchantReference(reference: string): string | null {
  const m = /^GP-(GP-\d{6}-[A-Z0-9]{4})-/i.exec(reference.trim());
  return m ? m[1].toUpperCase() : null;
}

export function normalisePaymentReturnKind(raw: string): PaymentReturnKind {
  const s = raw.trim().toLowerCase();
  switch (s) {
    case 'success':
    case 'confirmed':
      return 'success';
    case 'pending':
      return 'pending';
    case 'review_required':
      return 'review_required';
    case 'already_settled':
      return 'already_settled';
    case 'failed':
      return 'failed';
    default:
      // Includes `unknown_attempt`, an empty status, and anything unexpected.
      // Unknown is unknown: we do not tell the customer their money is safe.
      return 'unknown_attempt';
  }
}

export function paymentReturnCopy(kind: PaymentReturnKind, orderNumber: string | null): PaymentReturnCopy {
  const trackHref = orderNumber ? `/track-order?reference=${encodeURIComponent(orderNumber)}` : '/track-order';
  const ref = orderNumber ? ` ${orderNumber}` : '';

  switch (kind) {
    case 'success':
      return {
        kind,
        tone: 'success',
        title: 'Payment received',
        money: `We have your payment for order${ref}. Thank you.`,
        next: 'We will call or message you on the number from your order when it is on its way.',
        primaryCta: { label: 'Track this order', href: trackHref },
        secondaryCta: { label: 'Continue shopping', href: '/shop' },
        offerHelp: false,
      };
    case 'already_settled':
      return {
        kind,
        tone: 'success',
        title: 'This order is already paid',
        money: `Order${ref} was paid earlier. This attempt did not take a second payment.`,
        next: 'There is nothing more to do. We will contact you when it is on its way.',
        primaryCta: { label: 'Track this order', href: trackHref },
        secondaryCta: { label: 'Continue shopping', href: '/shop' },
        offerHelp: false,
      };
    case 'pending':
      return {
        kind,
        tone: 'wait',
        title: 'Waiting for your payment to clear',
        money: `Your payment for order${ref} has started but has not cleared yet. If you approved it on your phone, it usually clears within a few minutes.`,
        next: 'Please do not pay again, because that could charge you twice. Check the order in a few minutes, or ask us and we will check for you.',
        primaryCta: { label: 'Check this order', href: trackHref },
        secondaryCta: { label: 'Back to the shop', href: '/shop' },
        offerHelp: true,
      };
    case 'review_required':
      return {
        kind,
        tone: 'wait',
        title: 'We are checking your payment',
        money: `We received a response about your payment for order${ref} and need to confirm it by hand before we can mark the order paid.`,
        next: 'Please do not pay again. Our team will confirm it and contact you on the number from your order.',
        primaryCta: { label: 'Check this order', href: trackHref },
        secondaryCta: { label: 'Back to the shop', href: '/shop' },
        offerHelp: true,
      };
    case 'failed':
      return {
        kind,
        tone: 'failed',
        title: 'Payment did not go through',
        // FAILED covers a provider "reversed" as well as a plain decline, so
        // this cannot flatly say "not charged": on a reversal money did leave
        // and is on its way back.
        money: `Your payment for order${ref} did not go through, so the order is not paid. If money left your phone or card, it will come back. Tell us if it does not.`,
        next: 'Your order is saved, and paying again will not create a second one. If the checkout looks empty when you go back, send us your order number on WhatsApp and we will help you pay.',
        primaryCta: { label: 'Try payment again', href: '/checkout' },
        secondaryCta: { label: 'Back to the shop', href: '/shop' },
        offerHelp: true,
      };
    case 'unknown_attempt':
    default:
      return {
        kind: 'unknown_attempt',
        tone: 'wait',
        title: 'We could not confirm your payment',
        money: orderNumber
          ? `We cannot yet confirm the payment for order ${orderNumber}.`
          : 'We cannot yet confirm this payment.',
        next: 'Please do not pay again until we have checked. Send us your order number on WhatsApp and we will confirm what happened.',
        primaryCta: { label: 'Check this order', href: trackHref },
        secondaryCta: { label: 'Back to the shop', href: '/shop' },
        offerHelp: true,
      };
  }
}
