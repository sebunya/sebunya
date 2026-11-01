/**
 * Creator commission maths and attribution precedence (U4). Pure domain.
 */

export type AttributionMechanism = 'code' | 'link' | 'survey';

// Precedence: code beats link beats survey. The winner is the primary attribution;
// the others are kept for overlap reporting but never add revenue.
const MECHANISM_RANK: Record<AttributionMechanism, number> = { code: 0, link: 1, survey: 2 };
const MECHANISM_CONFIDENCE: Record<AttributionMechanism, 'high' | 'medium' | 'low'> = { code: 'high', link: 'medium', survey: 'low' };

export function attributionConfidence(mechanism: AttributionMechanism): 'high' | 'medium' | 'low' {
  return MECHANISM_CONFIDENCE[mechanism];
}

/** Choose the single primary mechanism from those that fired for an order. */
export function primaryMechanism(fired: AttributionMechanism[]): AttributionMechanism | null {
  if (fired.length === 0) return null;
  return [...fired].sort((a, b) => MECHANISM_RANK[a] - MECHANISM_RANK[b])[0];
}

export interface CommissionInput {
  grossRevenueUgx: number;
  deliveryFeeUgx: number;
  taxUgx: number;
  commissionRateBps: number;
  commissionCapUgx?: number | null;
}

export interface CommissionResult {
  commissionableRevenueUgx: number;
  commissionAmountUgx: number;
}

/**
 * Commissionable revenue excludes delivery fee and tax. Commission = rate applied
 * to commissionable revenue, floored to the integer UGX and capped.
 */
export function computeCommission(input: CommissionInput): CommissionResult {
  const commissionableRevenueUgx = Math.max(0, input.grossRevenueUgx - input.deliveryFeeUgx - input.taxUgx);
  let commissionAmountUgx = Math.floor((commissionableRevenueUgx * input.commissionRateBps) / 10_000);
  if (input.commissionCapUgx != null) commissionAmountUgx = Math.min(commissionAmountUgx, input.commissionCapUgx);
  return { commissionableRevenueUgx, commissionAmountUgx };
}

export interface WithholdingResult {
  grossAmountUgx: number;
  withholdingTaxUgx: number;
  netAmountUgx: number;
}

/**
 * Withholding tax at a configured effective-dated rate (basis points). The rate
 * is authoritative configuration supplied by finance — never a fabricated
 * constant. gross - withholding = net, exactly.
 */
export function computeWithholding(grossAmountUgx: number, withholdingRateBps: number): WithholdingResult {
  const withholdingTaxUgx = Math.floor((grossAmountUgx * withholdingRateBps) / 10_000);
  return { grossAmountUgx, withholdingTaxUgx, netAmountUgx: grossAmountUgx - withholdingTaxUgx };
}
