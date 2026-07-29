import { IInventoryRepository } from '../../ports/IInventoryRepository';
import { validateStockAdjustment } from '../../../domain/inventory/Inventory';

/**
 * Sets a product's on-hand stock atomically.
 *
 * The shape of the number is checked here; the comparison against reserved
 * quantity is NOT, because doing it here would mean reading, deciding, and then
 * writing — and a checkout reserving the last units in that window would slip
 * straight through a validation that passed against a stale figure. The
 * repository performs the comparison and the write as one statement.
 */
export class SetProductStockUseCase {
  constructor(private readonly repo: IInventoryRepository) {}

  async execute(
    productId: string,
    newStock: number,
  ): Promise<{ applied: boolean; reserved: number; stock: number } | null> {
    const shape = validateStockAdjustment(0, newStock);
    if (!shape.allowed) {
      throw new Error(`INVALID_STOCK_QUANTITY: ${shape.message}`);
    }
    return this.repo.setStockQuantity(productId, newStock);
  }
}
