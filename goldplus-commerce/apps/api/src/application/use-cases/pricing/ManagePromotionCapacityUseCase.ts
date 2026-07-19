import { IPricingCapacityRepository } from '../../ports/IPricingCapacityRepository';

export class PricingCapacityError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export class ManagePromotionCapacityUseCase {
  constructor(private readonly capacity: IPricingCapacityRepository) {}

  reserve(input: { quoteId: string; checkoutKey: string; now?: Date }) {
    if (!input.quoteId || !/^[a-zA-Z0-9:_-]{3,160}$/.test(input.checkoutKey)) throw new PricingCapacityError('INVALID_RESERVATION', 'Quote and bounded checkout idempotency key are required.');
    return this.capacity.reserveQuote({ quoteId: input.quoteId, idempotencyKey: input.checkoutKey, now: input.now ?? new Date() });
  }

  redeem(input: { quoteId: string; orderId: string; now?: Date }) {
    if (!input.quoteId || !input.orderId) throw new PricingCapacityError('INVALID_REDEMPTION', 'Quote and order are required.');
    return this.capacity.redeemQuote({ quoteId: input.quoteId, orderId: input.orderId, now: input.now ?? new Date() });
  }

  release(input: { quoteId: string; now?: Date }) {
    if (!input.quoteId) throw new PricingCapacityError('INVALID_RELEASE', 'Quote is required.');
    return this.capacity.releaseQuote({ quoteId: input.quoteId, now: input.now ?? new Date() });
  }
}
