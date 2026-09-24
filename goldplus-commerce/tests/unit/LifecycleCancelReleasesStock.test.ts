import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReleaseCancelledOrderHoldsUseCase } from '../../apps/api/src/application/use-cases/commerce/ReleaseCancelledOrderHoldsUseCase';

/**
 * An order cancelled through the LIFECYCLE (the admin order page's "cancelled"
 * transition, or a provider reversal) released its loyalty points but kept its
 * units in products.reserved_quantity forever. Only the fulfilment-task CANCELLED
 * route and the payment sweeps released stock, and the sweeps only look at
 * received/pending_payment orders, so nothing ever caught it later.
 */

function build(opts: { inventoryThrows?: boolean; redemptionThrows?: boolean } = {}) {
  const calls: string[] = [];
  const failures: string[] = [];
  const useCase = new ReleaseCancelledOrderHoldsUseCase({
    releaseInventory: {
      execute: async (orderId: string) => {
        calls.push(`inventory:${orderId}`);
        if (opts.inventoryThrows) throw new Error('db down');
        return { released: true };
      },
    },
    releaseRedemption: {
      execute: async ({ orderId }: { orderId: string }) => {
        calls.push(`redemption:${orderId}`);
        if (opts.redemptionThrows) throw new Error('loyalty down');
        return { ok: true };
      },
    },
    onFailed: (hold) => failures.push(hold),
  });
  return { useCase, calls, failures };
}

describe('a cancelled order gives back what it held', () => {
  it('releases the reserved stock, not only the points', async () => {
    const { useCase, calls } = build();
    await useCase.execute('order-1');
    expect(calls).toContain('inventory:order-1');
    expect(calls).toContain('redemption:order-1');
  });

  it('a loyalty failure does not keep the stock held', async () => {
    const { useCase, calls, failures } = build({ redemptionThrows: true });
    await expect(useCase.execute('order-1')).resolves.toBeUndefined();
    expect(calls).toContain('inventory:order-1');
    expect(failures).toEqual(['redemption']);
  });

  it('a stock-release failure is reported and never fails the transition', async () => {
    const { useCase, failures } = build({ inventoryThrows: true });
    await expect(useCase.execute('order-1')).resolves.toBeUndefined();
    expect(failures).toEqual(['inventory']);
  });
});

describe('the lifecycle subscriber runs it on every cancel', () => {
  const src = readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/Registry.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const subscriber = src.slice(src.indexOf('private registerOrderTransitionSubscribers('));

  it('the cancelled branch releases the order holds, stock included', () => {
    const branch = subscriber.slice(subscriber.indexOf("if (toStatus === 'cancelled')"));
    expect(branch.slice(0, 200)).toMatch(/this\.releaseCancelledOrderHoldsUseCase\.execute\(orderId\)/);
  });

  it('the holds use case is wired to the real inventory release', () => {
    expect(src).toMatch(/releaseInventory: this\.releaseInventoryForOrderUseCase/);
    expect(src).toMatch(/releaseRedemption: this\.releaseRedemptionUseCase/);
  });
});
