import { DeliveryBandPolicy, FeeObservationSummary } from '../../domain/commerce/DeliveryFeePrediction';

export interface StoredDeliveryBandPolicy extends DeliveryBandPolicy {
  note: string | null;
  updatedAt: Date;
}

export interface IDeliveryPricingPolicyRepository {
  /** The single policy row, or null when never saved (defaults then apply). */
  get(): Promise<StoredDeliveryBandPolicy | null>;
  save(policy: DeliveryBandPolicy, opts: { note: string | null; actorId: string | null }): Promise<StoredDeliveryBandPolicy>;
}

/**
 * Reads the order book as the fee-observation stream: every order whose
 * delivery fee an operator CONFIRMED is one labelled data point for its
 * district. Deliberately a read model over orders — no learning tables to
 * drift out of sync with reality.
 */
export interface IDeliveryFeeObservationReader {
  /** Median confirmed fee + sample size per canonical district (upper-case key). */
  summarizeByDistrict(): Promise<Map<string, FeeObservationSummary>>;
}
