import { describe, it, expect } from 'vitest';
import {
  computeAvailable,
  reservableQuantity,
  backorderShortfall,
  isLowStock,
  summariseReservation,
} from '../../apps/api/src/domain/inventory/Inventory';
import { Order } from '../../apps/api/src/domain/commerce/Order';
import {
  IInventoryRepository,
  AvailabilityRow,
} from '../../apps/api/src/application/ports/IInventoryRepository';
import { ReservationLineRequest, ReservationOutcome } from '../../apps/api/src/domain/inventory/Inventory';
import {
  ReserveInventoryForOrderUseCase,
  ReleaseInventoryForOrderUseCase,
  ConsumeInventoryForOrderUseCase,
  ListLowStockUseCase,
} from '../../apps/api/src/application/use-cases/inventory/InventoryUseCases';

// ---------- pure domain ----------

describe('Inventory domain (Section 12)', () => {
  it('available never goes negative', () => {
    expect(computeAvailable(10, 3)).toBe(7);
    expect(computeAvailable(3, 10)).toBe(0);
  });

  it('reservable never oversells', () => {
    expect(reservableQuantity(5, 3)).toBe(3);
    expect(reservableQuantity(2, 5)).toBe(2); // capped at available
    expect(reservableQuantity(0, 5)).toBe(0);
    expect(reservableQuantity(5, 0)).toBe(0);
  });

  it('backorder shortfall is requested minus reserved', () => {
    expect(backorderShortfall(5, 2)).toBe(3);
    expect(backorderShortfall(5, 5)).toBe(0);
  });

  it('low stock only when a reorder point is set and available is at/below it', () => {
    expect(isLowStock({ stockOnHand: 10, reserved: 0, reorderPoint: 0 })).toBe(false); // no point set
    expect(isLowStock({ stockOnHand: 10, reserved: 3, reorderPoint: 5 })).toBe(false); // available 7 > 5
    expect(isLowStock({ stockOnHand: 8, reserved: 3, reorderPoint: 5 })).toBe(true); // available 5 <= 5
  });

  it('summarise reports backorder warnings truthfully', () => {
    const outcome = summariseReservation('o1', [
      { productId: 'p1', requested: 2, reserved: 2, shortfall: 0 },
      { productId: 'p2', requested: 5, reserved: 3, shortfall: 2 },
    ]);
    expect(outcome.fullyReserved).toBe(false);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toMatch(/Backorder: 2 of 5/);
  });
});

// ---------- in-memory ledger fake ----------

class InMemoryInventoryRepo implements IInventoryRepository {
  // productId -> {stock, reserved, reorder, sku, name}
  products = new Map<string, { stock: number; reserved: number; reorder: number; sku: string; name: string }>();
  // orderId -> lines
  reservations = new Map<string, { productId: string; requested: number; reserved: number; status: string }[]>();

  seed(productId: string, stock: number, reorder = 0) {
    this.products.set(productId, { stock, reserved: 0, reorder, sku: `SKU-${productId}`, name: `Product ${productId}` });
  }

  async reserveForOrder(orderId: string, lines: ReservationLineRequest[]): Promise<ReservationOutcome> {
    if (this.reservations.has(orderId)) {
      const existing = this.reservations.get(orderId)!;
      return summariseReservation(orderId, existing.map((r) => ({ productId: r.productId, requested: r.requested, reserved: r.reserved, shortfall: r.requested - r.reserved })), true);
    }
    // All-or-nothing: reserve every line fully, or nothing at all.
    const feasible = lines.every((l) => {
      const p = this.products.get(l.productId);
      return p ? Math.max(0, p.stock - p.reserved) >= l.quantity : false;
    });
    const out = [];
    const stored = [];
    for (const l of lines) {
      const reserved = feasible ? l.quantity : 0;
      if (feasible) {
        const p = this.products.get(l.productId)!;
        p.reserved += reserved;
        stored.push({ productId: l.productId, requested: l.quantity, reserved, status: 'reserved' });
      }
      out.push({ productId: l.productId, requested: l.quantity, reserved, shortfall: l.quantity - reserved });
    }
    if (feasible) this.reservations.set(orderId, stored);
    return summariseReservation(orderId, out, false);
  }

  async releaseForOrder(orderId: string): Promise<{ released: boolean }> {
    const rs = this.reservations.get(orderId);
    if (!rs) return { released: false };
    let any = false;
    for (const r of rs) {
      if (r.status === 'reserved') {
        const p = this.products.get(r.productId);
        if (p) p.reserved = Math.max(0, p.reserved - r.reserved);
        r.status = 'released';
        any = true;
      }
    }
    return { released: any };
  }

  async consumeForOrder(orderId: string): Promise<{ consumed: boolean }> {
    const rs = this.reservations.get(orderId);
    if (!rs) return { consumed: false };
    let any = false;
    for (const r of rs) {
      if (r.status === 'reserved') {
        const p = this.products.get(r.productId);
        if (p) { p.stock = Math.max(0, p.stock - r.reserved); p.reserved = Math.max(0, p.reserved - r.reserved); }
        r.status = 'consumed';
        any = true;
      }
    }
    return { consumed: any };
  }

  async getAvailability(productIds: string[]): Promise<AvailabilityRow[]> {
    return productIds.filter((id) => this.products.has(id)).map((id) => this.row(id));
  }
  async listLowStock(limit: number): Promise<AvailabilityRow[]> {
    return [...this.products.keys()].map((id) => this.row(id)).filter((r) => r.lowStock).slice(0, limit);
  }
  private row(id: string): AvailabilityRow {
    const p = this.products.get(id)!;
    const available = Math.max(0, p.stock - p.reserved);
    return { productId: id, sku: p.sku, name: p.name, stockOnHand: p.stock, reserved: p.reserved, available, reorderPoint: p.reorder, lowStock: p.reorder > 0 && available <= p.reorder };
  }
}

function orderWith(id: string, items: { productId: string; quantity: number }[]): Order {
  return Order.create(
    id,
    { name: 'A', phone: '0770123456', deliveryArea: 'X', deliveryAddress: 'Y' },
    'retail',
    items.map((i) => ({ productId: i.productId, sku: `SKU-${i.productId}`, name: `P ${i.productId}`, price: 1000, quantity: i.quantity })),
    0,
    false
  );
}

// ---------- use cases ----------

describe('Inventory reservation use cases (Section 12)', () => {
  it('reserves available stock on OrderPlaced', async () => {
    const repo = new InMemoryInventoryRepo();
    repo.seed('p1', 10);
    const outcome = await new ReserveInventoryForOrderUseCase(repo).execute(orderWith('o1', [{ productId: 'p1', quantity: 3 }]));
    expect(outcome.fullyReserved).toBe(true);
    expect(repo.products.get('p1')!.reserved).toBe(3);
  });

  it('prevents oversell all-or-nothing: insufficient stock reserves NOTHING and backorders', async () => {
    const repo = new InMemoryInventoryRepo();
    repo.seed('p1', 2);
    const outcome = await new ReserveInventoryForOrderUseCase(repo).execute(orderWith('o1', [{ productId: 'p1', quantity: 5 }]));
    expect(repo.products.get('p1')!.reserved).toBe(0); // nothing held — no silent oversell
    expect(outcome.fullyReserved).toBe(false);
    expect(outcome.lines[0].reserved).toBe(0);
    expect(outcome.lines[0].shortfall).toBe(5);
    expect(outcome.warnings[0]).toMatch(/Backorder/);
  });

  it('multi-line is all-or-nothing: one short line rolls back every line', async () => {
    const repo = new InMemoryInventoryRepo();
    repo.seed('p1', 10);
    repo.seed('p2', 1);
    const outcome = await new ReserveInventoryForOrderUseCase(repo).execute(
      orderWith('o1', [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 3 }])
    );
    expect(outcome.fullyReserved).toBe(false);
    expect(repo.products.get('p1')!.reserved).toBe(0); // p1 rolled back despite being available
    expect(repo.products.get('p2')!.reserved).toBe(0);
  });

  it('is idempotent: re-reserving the same order does not double-reserve', async () => {
    const repo = new InMemoryInventoryRepo();
    repo.seed('p1', 10);
    const uc = new ReserveInventoryForOrderUseCase(repo);
    const order = orderWith('o1', [{ productId: 'p1', quantity: 3 }]);
    await uc.execute(order);
    const second = await uc.execute(order);
    expect(second.idempotentReplay).toBe(true);
    expect(repo.products.get('p1')!.reserved).toBe(3); // unchanged
  });

  it('releases reservations on cancel and restores available stock', async () => {
    const repo = new InMemoryInventoryRepo();
    repo.seed('p1', 10);
    await new ReserveInventoryForOrderUseCase(repo).execute(orderWith('o1', [{ productId: 'p1', quantity: 4 }]));
    const r = await new ReleaseInventoryForOrderUseCase(repo).execute('o1');
    expect(r.released).toBe(true);
    expect(repo.products.get('p1')!.reserved).toBe(0);
    // idempotent second release
    expect((await new ReleaseInventoryForOrderUseCase(repo).execute('o1')).released).toBe(false);
  });

  it('consumes stock at dispatch: deducts on-hand and clears reservation', async () => {
    const repo = new InMemoryInventoryRepo();
    repo.seed('p1', 10);
    await new ReserveInventoryForOrderUseCase(repo).execute(orderWith('o1', [{ productId: 'p1', quantity: 4 }]));
    const c = await new ConsumeInventoryForOrderUseCase(repo).execute('o1');
    expect(c.consumed).toBe(true);
    expect(repo.products.get('p1')!.stock).toBe(6);
    expect(repo.products.get('p1')!.reserved).toBe(0);
    // idempotent second consume
    expect((await new ConsumeInventoryForOrderUseCase(repo).execute('o1')).consumed).toBe(false);
  });

  it('two orders cannot oversell the same stock (all-or-nothing)', async () => {
    const repo = new InMemoryInventoryRepo();
    repo.seed('p1', 5);
    const uc = new ReserveInventoryForOrderUseCase(repo);
    const a = await uc.execute(orderWith('oa', [{ productId: 'p1', quantity: 4 }]));
    const b = await uc.execute(orderWith('ob', [{ productId: 'p1', quantity: 4 }]));
    expect(a.lines[0].reserved).toBe(4);
    expect(b.lines[0].reserved).toBe(0); // only 1 left, all-or-nothing → nothing
    expect(b.fullyReserved).toBe(false);
    expect(repo.products.get('p1')!.reserved).toBe(4); // never exceeds stock
  });

  it('low-stock list reflects reorder point against available', async () => {
    const repo = new InMemoryInventoryRepo();
    repo.seed('p1', 8, 5); // available 8 > 5, not low
    repo.seed('p2', 4, 5); // available 4 <= 5, low
    const low = await new ListLowStockUseCase(repo).execute();
    expect(low.map((r) => r.productId)).toEqual(['p2']);
  });
});
