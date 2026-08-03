import { describe, expect, it } from 'vitest';
import {
  AdjustStockUseCase,
  IStockAdjustmentRepository,
  StockAdjustment,
} from '../../apps/api/src/application/use-cases/inventory/AdjustStockUseCase';

/**
 * Wave 2E-2: adjustments never take stock negative, never undercut reserved holds
 * (reserved stock belongs to open orders), and always report true before/after.
 */
class FakeStockRepo implements IStockAdjustmentRepository {
  constructor(private stock: number, private reserved: number, private exists = true) {}
  writes: number[] = [];
  async adjust(
    _productId: string,
    compute: (current: { stock: number; reserved: number }) => number,
  ): Promise<StockAdjustment | null> {
    if (!this.exists) return null;
    const before = this.stock;
    const after = compute({ stock: this.stock, reserved: this.reserved });
    if (after !== before) {
      this.stock = after;
      this.writes.push(after);
    }
    return { productId: 'p1', before, after, reserved: this.reserved };
  }
}

describe('AdjustStockUseCase', () => {
  it('sets and deltas with true before/after', async () => {
    const repo = new FakeStockRepo(10, 2);
    const useCase = new AdjustStockUseCase(repo);
    const set = await useCase.execute({ productId: 'p1', mode: 'set', value: 25 });
    expect(set).toMatchObject({ ok: true, adjustment: { before: 10, after: 25 } });
    const delta = await useCase.execute({ productId: 'p1', mode: 'delta', value: -5 });
    expect(delta).toMatchObject({ ok: true, adjustment: { before: 25, after: 20 } });
  });

  it('refuses negative results and non-integers, writing nothing', async () => {
    const repo = new FakeStockRepo(3, 0);
    const useCase = new AdjustStockUseCase(repo);
    expect(await useCase.execute({ productId: 'p1', mode: 'delta', value: -9 })).toMatchObject({ ok: false, code: 'NEGATIVE_STOCK' });
    expect(await useCase.execute({ productId: 'p1', mode: 'set', value: -1 })).toMatchObject({ ok: false, code: 'NEGATIVE_STOCK' });
    expect(await useCase.execute({ productId: 'p1', mode: 'delta', value: 1.5 })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(repo.writes).toEqual([]);
  });

  it('refuses dropping below reserved holds', async () => {
    const repo = new FakeStockRepo(10, 6);
    const useCase = new AdjustStockUseCase(repo);
    const refused = await useCase.execute({ productId: 'p1', mode: 'set', value: 4 });
    expect(refused).toMatchObject({ ok: false, code: 'BELOW_RESERVED' });
    expect(repo.writes).toEqual([]);
    // Exactly at reserved is allowed.
    expect(await useCase.execute({ productId: 'p1', mode: 'set', value: 6 })).toMatchObject({ ok: true });
  });

  it('reports a missing product', async () => {
    const useCase = new AdjustStockUseCase(new FakeStockRepo(0, 0, false));
    expect(await useCase.execute({ productId: 'nope', mode: 'set', value: 1 })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
