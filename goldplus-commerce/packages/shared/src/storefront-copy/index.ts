/**
 * Miscellaneous operator-editable storefront copy that has no richer home of its
 * own — the support landing intro and the checkout payment-method labels. One
 * admin-editable JSONB document (storefront_copy singleton); the method KEYS
 * (offline | pesapal) are code-bound, only their display copy is editable.
 */
export interface PaymentMethodCopy {
  label: string;
  description: string;
}

export interface StorefrontCopy {
  supportHeading: string;
  supportIntro: string;
  payment: {
    offline: PaymentMethodCopy;
    pesapal: PaymentMethodCopy;
  };
}

export const DEFAULT_STOREFRONT_COPY: StorefrontCopy = {
  supportHeading: 'How can we help?',
  supportIntro: 'Buying, waiting on an order, or worried a product might be fake? Start here and our team will sort it out with you.',
  payment: {
    // "Cash / Manual Invoice" and "Mobile Money & Card via PesaPal" were our
    // words, not a customer's: an invoice is a shop's document, and a payment
    // gateway's name is not a payment method a shopper recognises. Each option
    // now says WHEN you pay and WHAT you pay with, in the order a person thinks
    // about it, and promises only what actually happens: the delivery fee is
    // agreed with you first, because the quoting service publishes no fee yet.
    offline: {
      label: 'Pay on delivery or at our shop',
      description: 'Order now and pay nothing today. We agree the delivery fee with you first, then you pay when your order reaches you, or when you collect it from our shop.',
    },
    pesapal: {
      label: 'Pay now with Mobile Money or card',
      description: 'Pay straight away with MTN or Airtel Mobile Money, or a Visa or Mastercard. We take you to PesaPal to finish, and your order is confirmed as soon as the money goes through.',
    },
  },
};
