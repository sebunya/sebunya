import { ICouponRepository, CouponRedeemResult } from '../../ports/ICouponRepository';
import { normalizeCouponCode } from '../../../domain/pricing/Pricing';

export interface RedeemCouponInput {
  code: string;
  orderId: string;
  customerIdentityHash: string;
  discountAmountUgx: number;
}

export type RedeemCouponOutcome =
  | { ok: true; alreadyRedeemed: boolean; couponId: string; redemptionId: string }
  | { ok: false; reason: 'COUPON_INVALID' | 'COUPON_NOT_FOUND' | CouponRedeemFailure };

type CouponRedeemFailure = Exclude<CouponRedeemResult, { ok: true }>['reason'];

/**
 * Application entry point for coupon redemption (U1). Normalises the code
 * (case-insensitive, whitespace-tolerant), resolves the coupon, and delegates
 * the exactly-once redemption to the inventory. The engine/checkout supplies the
 * already-computed discount; this use case does not compute prices.
 */
export class RedeemCouponUseCase {
  constructor(private readonly coupons: ICouponRepository) {}

  async execute(input: RedeemCouponInput): Promise<RedeemCouponOutcome> {
    let normalised: string | null;
    try {
      normalised = normalizeCouponCode(input.code);
    } catch {
      return { ok: false, reason: 'COUPON_INVALID' };
    }
    if (!normalised) return { ok: false, reason: 'COUPON_INVALID' };

    const coupon = await this.coupons.findByNormalisedCode(normalised);
    if (!coupon) return { ok: false, reason: 'COUPON_NOT_FOUND' };

    const result = await this.coupons.redeem({
      couponId: coupon.id,
      orderId: input.orderId,
      customerIdentityHash: input.customerIdentityHash,
      discountAmountUgx: input.discountAmountUgx,
    });
    if (result.ok) {
      return { ok: true, alreadyRedeemed: result.alreadyRedeemed, couponId: coupon.id, redemptionId: result.redemptionId };
    }
    return { ok: false, reason: result.reason };
  }
}
