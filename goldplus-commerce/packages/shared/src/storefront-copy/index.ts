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
    offline: {
      label: 'Cash / Manual Invoice',
      description: 'Place your order now. Our team confirms your delivery details with you, then sends a final invoice to pay.',
    },
    pesapal: {
      label: 'Mobile Money & Card via PesaPal',
      description: 'Pay now with MTN or Airtel Mobile Money, or a bank card, through PesaPal.',
    },
  },
};
