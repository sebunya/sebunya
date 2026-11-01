import { RfmInput } from '../../domain/customer-dna/Rfm';

/** Read-only aggregation of per-customer order facts for RFM scoring. */
export interface ICustomerRfmRepository {
  /**
   * One row per customer with a paid order placed at or before `asOf`: last
   * order, count, total spend. An order after `asOf` does not exist yet for a
   * score computed at that instant.
   */
  aggregateCustomers(limit: number, asOf: Date): Promise<RfmInput[]>;
}
