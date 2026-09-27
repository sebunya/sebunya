import { describe, expect, it } from 'vitest';
import {
  MutateCartUseCase,
  type CartOwner,
  type CartProductReader,
  type CartRecord,
  type CartStockLimit,
  type ICartAuthorizedRepository,
} from '../../apps/api/src/application/use-cases/commerce/MutateCartUseCase';
import { cartStockLimit } from '../../apps/api/src/domain/inventory/Inventory';
import { Order, initialOrderStatus } from '../../apps/api/src/domain/commerce/Order';
import { canTransitionOrder } from '../../apps/api/src/domain/commerce/OrderStateMachine';
import { validatePaymentsOpsValue } from '../../apps/api/src/domain/payments/PaymentsOpsConfig';

class FakeCartRepo implements ICartAuthorizedRepository {
  record: CartRecord | null = null;
  async find(cartId: string) {
    return this.record && this.record.id === cartId ? structuredClone(this.record) : null;
  }
  async create(cartId: string, owner: CartOwner) {
    if (!this.record) this.record = { id: cartId, version: 1, ownerKind: owner.kind, ownerId: owner.id, items: [] };
  }
  async claimOwnership() {
    return false;
  }
  async replaceItems(args: { cartId: string; expectedVersion: number; items: Array<{ productId: string; quantity: number }> }) {
    if (!this.record || this.record.version !== args.expectedVersion) return false;
    this.record.items = args.items.map((i) => ({ productId: i.productId, name: '', unitPriceUgx: 0, quantity: i.quantity }));
    this.record.version += 1;
    return true;
  }
}

const owner: CartOwner = { kind: 'GUEST', id: 'g-1' };
const readerWith = (stock: Record<string, CartStockLimit | undefined>): CartProductReader => ({
  async findPurchasable(ids) {
    return ids.map((id) => ({ id, name: id, unitPriceUgx: 1000, stock: stock[id] }));
  },
});
const add = (uc: MutateCartUseCase, productId: string, quantity: number) =>
  uc.mutate({ cartId: 'c-1', owner, mutation: { kind: 'ADD', productId, quantity }, traceId: 't' });

describe('cartStockLimit', () => {
  const base = { stockStatus: 'in_stock', isPreOrderEnabled: false, inventoryPolicy: 'STOCK_CONTROLLED', stockQuantity: 5, reservedQuantity: 2 };
  it('reports available = on hand minus reserved', () => {
    expect(cartStockLimit(base)).toEqual({ outOfStock: false, available: 3 });
  });
  it('out_of_stock label is out of stock', () => {
    expect(cartStockLimit({ ...base, stockStatus: 'out_of_stock' }).outOfStock).toBe(true);
  });
  it('all units reserved is out of stock', () => {
    expect(cartStockLimit({ ...base, reservedQuantity: 5 })).toEqual({ outOfStock: true, available: 0 });
  });
  it('untracked (0 on hand, in-stock label), pre-order and non-stock items never block', () => {
    expect(cartStockLimit({ ...base, stockQuantity: 0 })).toEqual({ outOfStock: false, available: null });
    expect(cartStockLimit({ ...base, stockStatus: 'pre_order', stockQuantity: 0 }).available).toBeNull();
    expect(cartStockLimit({ ...base, isPreOrderEnabled: true, stockStatus: 'out_of_stock' }).outOfStock).toBe(false);
    expect(cartStockLimit({ ...base, inventoryPolicy: 'NON_STOCK_ITEM' }).available).toBeNull();
  });
});

describe('MutateCartUseCase stock check', () => {
  it('refuses adding an out-of-stock product', async () => {
    const uc = new MutateCartUseCase({ carts: new FakeCartRepo(), products: readerWith({ p: { outOfStock: true, available: 0 } }) });
    const out = await add(uc, 'p', 1);
    expect(out).toEqual({ kind: 'OUT_OF_STOCK', reason: 'p', available: 0 });
  });

  it('refuses a quantity above known stock, counting what is already in the basket', async () => {
    const repo = new FakeCartRepo();
    const uc = new MutateCartUseCase({ carts: repo, products: readerWith({ p: { outOfStock: false, available: 3 } }) });
    expect((await add(uc, 'p', 2)).kind).toBe('APPLIED');
    expect(await add(uc, 'p', 2)).toEqual({ kind: 'OUT_OF_STOCK', reason: 'p', available: 3 });
    expect(await uc.mutate({ cartId: 'c-1', owner, mutation: { kind: 'UPDATE', productId: 'p', quantity: 4 }, traceId: 't' }))
      .toEqual({ kind: 'OUT_OF_STOCK', reason: 'p', available: 3 });
    expect((await add(uc, 'p', 1)).kind).toBe('APPLIED');
  });

  it('never blocks lowering a line or untracked stock', async () => {
    const repo = new FakeCartRepo();
    repo.record = { id: 'c-1', version: 1, ownerKind: 'GUEST', ownerId: 'g-1', items: [{ productId: 'p', name: '', unitPriceUgx: 0, quantity: 5 }] };
    const uc = new MutateCartUseCase({ carts: repo, products: readerWith({ p: { outOfStock: true, available: 0 }, q: undefined }) });
    expect((await uc.mutate({ cartId: 'c-1', owner, mutation: { kind: 'UPDATE', productId: 'p', quantity: 2 }, traceId: 't' })).kind).toBe('APPLIED');
    expect((await add(uc, 'q', 50)).kind).toBe('APPLIED');
  });
});

describe('owner-review threshold', () => {
  it('is off by default: retail starts received at any total', () => {
    expect(initialOrderStatus('retail', 50_000_000, null)).toBe('received');
    expect(initialOrderStatus('retail', 50_000_000, undefined)).toBe('received');
  });
  it('retail at or above the threshold starts in owner review; below does not', () => {
    expect(initialOrderStatus('retail', 1_000_000, 1_000_000)).toBe('pending_owner_review');
    expect(initialOrderStatus('retail', 999_999, 1_000_000)).toBe('received');
  });
  it('wholesale/corporate always start in owner review', () => {
    expect(initialOrderStatus('wholesale', 1, null)).toBe('pending_owner_review');
    expect(initialOrderStatus('corporate', 1, 10_000_000)).toBe('pending_owner_review');
  });
  it('Order.create applies the threshold to the order total and the state stays valid', () => {
    const customer = { name: 'A', phone: '0700000000', email: null, deliveryArea: 'Kampala', deliveryAddress: 'x' } as never;
    const items = [{ productId: 'p', sku: 's', name: 'n', price: 600_000, quantity: 2 }];
    const held = Order.create('11111111-2222-3333-4444-555555555555', customer, 'retail', items, 0, true, null, null, null, 1_000_000);
    expect(held.orderStatus).toBe('pending_owner_review');
    expect(canTransitionOrder('pending_owner_review', 'processing', { paymentStatus: 'paid' }).allowed).toBe(true);
    const normal = Order.create('11111111-2222-3333-4444-555555555556', customer, 'retail', items, 0, true);
    expect(normal.orderStatus).toBe('received');
  });
  it('the setting is a validated UGX integer in the ops registry', () => {
    expect(validatePaymentsOpsValue('owner_review_threshold_ugx', '2000000')).toEqual({ ok: true, value: 2_000_000 });
    expect(validatePaymentsOpsValue('owner_review_threshold_ugx', '0').ok).toBe(false);
    expect(validatePaymentsOpsValue('owner_review_threshold_ugx', '1.5').ok).toBe(false);
  });
});
