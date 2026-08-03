import { describe, expect, it } from 'vitest';
import {
  MutateCartUseCase,
  type CartOwner,
  type CartProductReader,
  type CartRecord,
  type ICartAuthorizedRepository,
} from '../../apps/api/src/application/use-cases/commerce/MutateCartUseCase';

/**
 * Regression suite for RC-7 (server cart never created — first ADD returned
 * CART_NOT_FOUND for every shopper) and the catalogue-pricing invariant
 * (do-not-break ledger #4/#5). These behaviours shipped to production untested;
 * they must never again depend on a live E2E to be noticed.
 */

class FakeCartRepo implements ICartAuthorizedRepository {
  record: CartRecord | null = null;
  createCalls = 0;

  async find(cartId: string): Promise<CartRecord | null> {
    return this.record && this.record.id === cartId ? structuredClone(this.record) : null;
  }

  async create(cartId: string, owner: CartOwner): Promise<void> {
    this.createCalls += 1;
    if (!this.record) {
      this.record = { id: cartId, version: 1, ownerKind: owner.kind, ownerId: owner.id, items: [] };
    }
  }

  async claimOwnership(cartId: string, owner: CartOwner): Promise<boolean> {
    if (this.record && this.record.id === cartId && this.record.ownerKind === null) {
      this.record.ownerKind = owner.kind;
      this.record.ownerId = owner.id;
      return true;
    }
    return false;
  }

  async replaceItems(args: {
    cartId: string;
    expectedVersion: number;
    items: Array<{ productId: string; quantity: number }>;
  }): Promise<boolean> {
    if (!this.record || this.record.id !== args.cartId || this.record.version !== args.expectedVersion) return false;
    // Mirrors the real repository: persisted lines are (productId, quantity); price is
    // hydrated from the catalogue, never stored from the request.
    this.record.items = args.items.map((i) => ({ productId: i.productId, name: '', unitPriceUgx: 0, quantity: i.quantity }));
    this.record.version += 1;
    return true;
  }
}

const CATALOGUE: Record<string, { id: string; name: string; unitPriceUgx: number }> = {
  'p-1': { id: 'p-1', name: 'Generic Fast Charger', unitPriceUgx: 50_000 },
};

const products: CartProductReader = {
  async findPurchasable(ids) {
    return ids.filter((id) => CATALOGUE[id]).map((id) => CATALOGUE[id]);
  },
};

const guest: CartOwner = { kind: 'GUEST', id: 'guest-1' };
const makeUseCase = (repo: FakeCartRepo) => new MutateCartUseCase({ carts: repo, products });

describe('MutateCartUseCase', () => {
  it('creates the cart on first ADD and prices the line from the catalogue (RC-7)', async () => {
    const repo = new FakeCartRepo();
    const outcome = await makeUseCase(repo).mutate({
      cartId: 'cart-1',
      owner: guest,
      mutation: { kind: 'ADD', productId: 'p-1', quantity: 1 },
      traceId: 't-1',
    });

    expect(repo.createCalls).toBe(1);
    expect(outcome.kind).toBe('APPLIED');
    if (outcome.kind === 'APPLIED') {
      expect(outcome.cart.items).toHaveLength(1);
      // Price must come from the catalogue read, never the request or the stored row.
      expect(outcome.cart.items[0].unitPriceUgx).toBe(50_000);
      expect(outcome.cart.subtotalUgx).toBe(50_000);
    }
  });

  it('does NOT create a cart for REMOVE/UPDATE/CLEAR on a missing cart', async () => {
    const repo = new FakeCartRepo();
    const useCase = makeUseCase(repo);
    for (const mutation of [
      { kind: 'REMOVE', productId: 'p-1' } as const,
      { kind: 'UPDATE', productId: 'p-1', quantity: 2 } as const,
      { kind: 'CLEAR' } as const,
    ]) {
      const outcome = await useCase.mutate({ cartId: 'cart-x', owner: guest, mutation, traceId: 't' });
      expect(outcome.kind).toBe('CART_NOT_FOUND');
    }
    expect(repo.createCalls).toBe(0);
  });

  it('refuses an ADD of a non-purchasable product', async () => {
    const repo = new FakeCartRepo();
    const outcome = await makeUseCase(repo).mutate({
      cartId: 'cart-1',
      owner: guest,
      mutation: { kind: 'ADD', productId: 'withdrawn', quantity: 1 },
      traceId: 't',
    });
    expect(outcome.kind).toBe('PRODUCT_UNAVAILABLE');
  });

  it('read() on a missing cart stays CART_NOT_FOUND (no silent create on read)', async () => {
    const repo = new FakeCartRepo();
    const outcome = await makeUseCase(repo).read({ cartId: 'nope', owner: guest, traceId: 't' });
    expect(outcome.kind).toBe('CART_NOT_FOUND');
    expect(repo.createCalls).toBe(0);
  });

  it('refuses a stale expectedVersion instead of applying over newer state', async () => {
    const repo = new FakeCartRepo();
    const useCase = makeUseCase(repo);
    await useCase.mutate({ cartId: 'cart-1', owner: guest, mutation: { kind: 'ADD', productId: 'p-1', quantity: 1 }, traceId: 't' });
    const conflicted = await useCase.mutate({
      cartId: 'cart-1',
      owner: guest,
      expectedVersion: 1, // real version is now 2
      mutation: { kind: 'ADD', productId: 'p-1', quantity: 1 },
      traceId: 't',
    });
    expect(conflicted.kind).toBe('VERSION_CONFLICT');
  });
});
