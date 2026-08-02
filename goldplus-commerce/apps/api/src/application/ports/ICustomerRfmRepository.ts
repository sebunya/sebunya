import { RfmInput } from '../../domain/customer-dna/Rfm';

/** Read-only aggregation of per-customer order facts for RFM scoring. */
export interface ICustomerRfmRepository {
  /** One row per customer with a paid order: last order, count, total spend. */
  aggregateCustomers(limit: number): Promise<RfmInput[]>;
}
