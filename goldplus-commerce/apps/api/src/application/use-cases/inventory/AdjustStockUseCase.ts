/**
 * Manual stock adjustment (Wave 2E-2).
 *
 * `products.stock_quantity` finally gets a governed write path: an adjustment is a
 * row-locked set-or-delta with the before/after captured for audit, refused when it
 * would take stock negative or undercut reserved holds (reserved stock belongs to
 * open orders — an adjustment cannot silently sell it twice).
 */

export interface StockAdjustment {
  productId: string;
  before: number;
  after: number;
  reserved: number;
}

export interface IStockAdjustmentRepository {
  /**
   * Atomically (row lock) reads current stock+reserved, computes the new value and
   * writes it. Returns null when the product does not exist.
   */
  adjust(productId: string, compute: (current: { stock: number; reserved: number }) => number): Promise<StockAdjustment | null>;
}

export type AdjustOutcome =
  | { ok: true; adjustment: StockAdjustment }
  | { ok: false; code: 'NOT_FOUND' | 'NEGATIVE_STOCK' | 'BELOW_RESERVED' | 'BAD_INPUT'; message: string };

export class AdjustStockUseCase {
  constructor(private readonly repo: IStockAdjustmentRepository) {}

  async execute(args: { productId: string; mode: 'set' | 'delta'; value: number }): Promise<AdjustOutcome> {
    if (!Number.isInteger(args.value)) {
      return { ok: false, code: 'BAD_INPUT', message: 'value must be an integer.' };
    }
    if (args.mode === 'set' && args.value < 0) {
      return { ok: false, code: 'NEGATIVE_STOCK', message: 'Stock cannot be set below zero.' };
    }

    let refusal: AdjustOutcome | null = null;
    const adjustment = await this.repo.adjust(args.productId, ({ stock, reserved }) => {
      const next = args.mode === 'set' ? args.value : stock + args.value;
      if (next < 0) {
        refusal = { ok: false, code: 'NEGATIVE_STOCK', message: `Refused: would take stock to ${next}.` };
        return stock;
      }
      if (next < reserved) {
        refusal = {
          ok: false,
          code: 'BELOW_RESERVED',
          message: `Refused: ${reserved} unit(s) are reserved for open orders; stock cannot drop below that.`,
        };
        return stock;
      }
      return next;
    });

    if (refusal) return refusal;
    if (!adjustment) return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    return { ok: true, adjustment };
  }
}
