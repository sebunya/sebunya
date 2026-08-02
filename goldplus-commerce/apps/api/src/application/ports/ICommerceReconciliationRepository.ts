import { OrderMoneyRow, InventoryRow } from '../../domain/commerce/CommerceIntegrity';

/**
 * Read-only scans for commerce integrity reconciliation. Returns the aggregated
 * facts; the pure domain decides what is an exception. Nothing here mutates.
 */
export interface ICommerceReconciliationRepository {
  /** Per-order money facts: stored totals vs the summed line items. */
  scanOrderMoney(limit: number): Promise<OrderMoneyRow[]>;
  /** Per-product inventory facts: stored reserved vs the active reservation ledger. */
  scanInventory(limit: number): Promise<InventoryRow[]>;
}
