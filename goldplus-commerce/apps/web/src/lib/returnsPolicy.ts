import { SITE_ORIGIN } from './sitemap';

/**
 * The returns policy as ONE fact, so the policy page, the FAQ, the product
 * pages' structured data and the merchant feed can never state different
 * windows. Set by the shop owner on 2026-09-01; changing the number here
 * changes every surface at once.
 *
 * Change of mind: 14 days, unused and complete, customer covers the return
 * carriage. Faulty: replaced or refunded with GoldPlus covering the carriage —
 * a separate and better promise, as consumer law expects.
 */
export const RETURNS_POLICY = {
  windowDays: 14,
  /** Who pays to send a change-of-mind return back. */
  changeOfMindShippingPaidBy: 'customer',
  /** Who pays when the product is faulty. */
  faultyShippingPaidBy: 'GoldPlus',
  country: 'UG',
  policyUrl: `${SITE_ORIGIN}/returns`,
} as const;

/** schema.org MerchantReturnPolicy — what Google reads for the returns badge. */
export function merchantReturnPolicyJsonLd() {
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: RETURNS_POLICY.country,
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: RETURNS_POLICY.windowDays,
    returnMethod: ['https://schema.org/ReturnInStore', 'https://schema.org/ReturnByMail'],
    returnFees: 'https://schema.org/ReturnShippingFees',
    merchantReturnLink: RETURNS_POLICY.policyUrl,
  };
}
