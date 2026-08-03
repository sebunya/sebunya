import { ICouponRepository } from '../../ports/ICouponRepository';
import { hashCustomerPhoneIdentity } from '../../../domain/pricing/CustomerIdentity';

export interface FirstOrderEligibilityResult {
  eligible: boolean;
  /** The phone-derived identity hash — pass this as the redemption's
   * customerIdentityHash so the same customer cannot claim it again. */
  customerIdentityHash: string;
  reason?: 'FIRST_ORDER_ALREADY_USED';
}

/**
 * U1 AC11 — first-order eligibility resolved through the phone-derived identity,
 * not by email. Two accounts sharing a phone collapse to one identity, so a
 * first-order promotion cannot be redeemed twice by re-registering.
 */
export class FirstOrderEligibilityUseCase {
  constructor(
    private readonly coupons: ICouponRepository,
    private readonly pepper: string,
  ) {}

  identityHash(phone: string): string {
    return hashCustomerPhoneIdentity(phone, this.pepper);
  }

  async check(promotionDefinitionId: string, phone: string): Promise<FirstOrderEligibilityResult> {
    const customerIdentityHash = this.identityHash(phone);
    const alreadyUsed = await this.coupons.hasRedeemedPromotionByIdentity(promotionDefinitionId, customerIdentityHash);
    return alreadyUsed
      ? { eligible: false, customerIdentityHash, reason: 'FIRST_ORDER_ALREADY_USED' }
      : { eligible: true, customerIdentityHash };
  }
}
