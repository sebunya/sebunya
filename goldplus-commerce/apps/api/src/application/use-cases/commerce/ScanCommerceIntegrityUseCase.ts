import { ICommerceReconciliationRepository } from '../../ports/ICommerceReconciliationRepository';
import { reconcileCommerce, ReconciliationException } from '../../../domain/commerce/CommerceIntegrity';

export interface CommerceIntegrityReport {
  scannedOrders: number;
  scannedProducts: number;
  exceptions: ReconciliationException[];
  clean: boolean;
}

/**
 * Scans commerce money and inventory integrity and SURFACES exceptions (§8).
 * It never mutates: reconciliation reports drift; correcting a stored total or a
 * reserved count is a deliberate operator action against a specific entity, not
 * something a scan may guess.
 */
export class ScanCommerceIntegrityUseCase {
  constructor(private readonly repo: ICommerceReconciliationRepository) {}

  async execute(limit = 1000): Promise<CommerceIntegrityReport> {
    const [orders, inventory, orderStock] = await Promise.all([
      this.repo.scanOrderMoney(limit),
      this.repo.scanInventory(limit),
      this.repo.scanOrderStock ? this.repo.scanOrderStock(limit) : Promise.resolve([]),
    ]);
    const exceptions = reconcileCommerce({ orders, inventory, orderStock });
    return {
      scannedOrders: orders.length,
      scannedProducts: inventory.length,
      exceptions,
      clean: exceptions.length === 0,
    };
  }
}
