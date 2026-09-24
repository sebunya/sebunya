import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MutateCartUseCase,
  type CartOwner,
  type CartRecord,
  type ICartAuthorizedRepository,
} from '../../apps/api/src/application/use-cases/commerce/MutateCartUseCase';

/**
 * Every line of a server-held basket linked to `/products/` — a 404 — because
 * the cart view carried no slug, so the storefront mapped each line with
 * `slug: ''`. The server cart is the normal production path, so every basket
 * line's image and name link was broken.
 */

const owner: CartOwner = { kind: 'GUEST', id: 'guest-1' };

function repoHolding(record: CartRecord): ICartAuthorizedRepository {
  let current = structuredClone(record);
  return {
    find: async (id) => (id === current.id ? structuredClone(current) : null),
    create: async () => undefined,
    claimOwnership: async () => false,
    replaceItems: async ({ expectedVersion, items }) => {
      if (expectedVersion !== current.version) return false;
      // Mirrors the real repository: the read joins products, so a persisted line
      // comes back with its name, price AND slug.
      current = {
        ...current,
        version: current.version + 1,
        items: items.map((i) => ({ productId: i.productId, name: 'Charger', slug: 'generic-fast-charger', unitPriceUgx: 50_000, quantity: i.quantity })),
      };
      return true;
    },
  };
}

const record: CartRecord = {
  id: 'cart-1',
  version: 1,
  ownerKind: 'GUEST',
  ownerId: 'guest-1',
  items: [{ productId: 'p-1', name: 'Charger', slug: 'generic-fast-charger', unitPriceUgx: 50_000, quantity: 1 }],
};

const products = { findPurchasable: async () => [{ id: 'p-1', name: 'Charger', unitPriceUgx: 50_000 }] };

describe('a cart line names the product page it belongs to', () => {
  it('the read view carries the slug', async () => {
    const useCase = new MutateCartUseCase({ carts: repoHolding(record), products });
    const outcome = await useCase.read({ cartId: 'cart-1', owner, traceId: 't' });
    expect(outcome.kind).toBe('APPLIED');
    if (outcome.kind === 'APPLIED') expect(outcome.cart.items[0].slug).toBe('generic-fast-charger');
  });

  it('a mutation answer carries the slug too', async () => {
    const useCase = new MutateCartUseCase({ carts: repoHolding(record), products });
    const outcome = await useCase.mutate({ cartId: 'cart-1', owner, expectedVersion: 1, mutation: { kind: 'UPDATE', productId: 'p-1', quantity: 2 }, traceId: 't' });
    expect(outcome.kind).toBe('APPLIED');
    if (outcome.kind === 'APPLIED') expect(outcome.cart.items[0].slug).toBe('generic-fast-charger');
  });

  it('the repository reads the slug from the products it already joins', () => {
    const src = readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzleAuthorizedCartRepository.ts'), 'utf8');
    const find = src.slice(src.indexOf('async find('), src.indexOf('async claimOwnership('));
    expect(find).toMatch(/slug: products\.slug/);
    expect(find).toMatch(/slug: line\.slug/);
  });
});
