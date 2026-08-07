export * from './types/api';

export const DOMAIN_EVENTS = {
  PRODUCT_PUBLISHED: 'PRODUCT_PUBLISHED',
  DEALER_APPLICATION_RECEIVED: 'DEALER_APPLICATION_RECEIVED',
  DEALER_APPLICATION_APPROVED: 'DEALER_APPLICATION_APPROVED',
  VERIFICATION_CHECK_REQUESTED: 'VERIFICATION_CHECK_REQUESTED',
  FAKE_PRODUCT_REPORTED: 'FAKE_PRODUCT_REPORTED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  DEALER_APPLICATION_SUBMITTED: 'DEALER_APPLICATION_SUBMITTED',
  AUDIT_LOG_CREATED: 'AUDIT_LOG_CREATED',
  PRODUCT_VERIFIED: 'PRODUCT_VERIFIED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
} as const;

export * from './types/product';
export * from './types/account';
export * from './permissions';
export * from './recommendations';
export * from './date-validation';
export * from './events/telemetry';
export * from './events/consent';
export * from './events/zero-party';
export * from './control-centre/module-registry';
export * from './types/checkout';
export * from './checkout-intent';
export * from './cart-credential';
export * from './analytics';
export * from './hero';
export * from './nav';
export * from './locations/uganda';
export * from './locations/uganda-geo';
export * from './locations/folding';
export * from './phone/uganda';
export * from './time/eat';
