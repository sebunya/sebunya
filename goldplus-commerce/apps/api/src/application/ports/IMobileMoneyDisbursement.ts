/**
 * U4 — mobile-money disbursement port (MTN MoMo / Airtel Money).
 *
 * NO-SEND in this programme: there are no verified sandbox credentials, so the
 * default adapter never contacts a provider and never claims settlement. A
 * provider reference is evidence, not proof of settlement — settlement requires a
 * verified provider status via a real adapter the business enables later.
 */
export interface DisbursementRequest {
  payoutId: string;
  method: 'mtn_momo' | 'airtel_money';
  destinationMasked: string;
  amountUgx: number;
  idempotencyKey: string;
}

export type DisbursementResult =
  | { status: 'NOT_CONFIGURED' }
  | { status: 'ACCEPTED'; providerReference: string }
  | { status: 'FAILED'; reason: string };

export interface IMobileMoneyDisbursement {
  disburse(request: DisbursementRequest): Promise<DisbursementResult>;
}

/**
 * Default no-send adapter. Returns NOT_CONFIGURED so a payout can be prepared and
 * approved but never silently marked settled without a real provider.
 */
export class NoSendMobileMoneyDisbursement implements IMobileMoneyDisbursement {
  async disburse(): Promise<DisbursementResult> {
    return { status: 'NOT_CONFIGURED' };
  }
}
