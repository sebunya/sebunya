import { describe, it, expect } from 'vitest';
import { CheckoutUseCase, IOrderRepository } from '../../apps/api/src/application/use-cases/commerce/CheckoutUseCase';
import { Order } from '../../apps/api/src/domain/commerce/Order';
import {
  normalizeDistrict,
  resolveDeliveryFee,
  validateDeliveryZoneInput,
  DeliveryZone,
} from '../../apps/api/src/domain/commerce/DeliveryFee';
import { IDeliveryZoneRepository } from '../../apps/api/src/application/ports/IDeliveryZoneRepository';
import { IProductRepository, ProductWithPrice } from '../../apps/api/src/application/ports/IProductRepository';

// ---------- fakes ----------

function fakeProduct(id: string, price: number | null): ProductWithPrice {
  return {
    entity: { id, sku: `SKU-${id}`, name: `Product ${id}` } as any,
    retailPriceUgx: price,
    categoryName: null,
    images: [],
    attributeValues: [],
  };
}

function fakeProducts(rows: ProductWithPrice[]): IProductRepository {
  return {
    async findPublicViewBySlug() {
      return null;
    },
    async findPublicViewList(opts) {
      const ids = opts?.ids ?? [];
      return rows.filter((r) => ids.includes((r.entity as any).id));
    },
  };
}

function fakeOrders(): IOrderRepository & { saved: Array<{ order: Order; clientOrderKey: string | null }> } {
  const saved: Array<{ order: Order; clientOrderKey: string | null }> = [];
  return {
    saved,
    async save(order, opts) {
      saved.push({ order, clientOrderKey: opts?.clientOrderKey ?? null });
    },
    async findById(id) {
      return saved.find((s) => s.order.id === id)?.order ?? null;
    },
    async findByClientKey(key) {
      return saved.find((s) => s.clientOrderKey === key)?.order ?? null;
    },
  };
}

function fakeZones(zones: DeliveryZone[]): IDeliveryZoneRepository {
  return {
    async findByDistrict(district) {
      return zones.find((z) => z.district === district) ?? null;
    },
    async list() {
      return zones;
    },
    async upsert() {
      throw new Error('not used');
    },
    async delete() {
      return false;
    },
  };
}

const customer = {
  name: 'Test Customer',
  phone: '0700000000',
  deliveryArea: 'Kampala Central',
  deliveryAddress: 'Plot 1',
  deliveryLocation: { district: 'Kampala', region: 'Central' },
};

// ---------- domain: delivery fee rules ----------

describe('DeliveryFee domain (Slice 3B)', () => {
  it('normalizes districts to a canonical key', () => {
    expect(normalizeDistrict('  kampala  ')).toBe('KAMPALA');
    expect(normalizeDistrict('Fort   Portal')).toBe('FORT PORTAL');
  });

  it('resolves a configured enabled zone to a confirmed fee', () => {
    const r = resolveDeliveryFee({ id: 'z1', district: 'KAMPALA', feeUgx: 10_000, enabled: true });
    expect(r).toEqual({ feeUgx: 10_000, confirmed: true, zoneId: 'z1' });
  });

  it('never invents a fee for missing or disabled zones', () => {
    expect(resolveDeliveryFee(null)).toEqual({ feeUgx: 0, confirmed: false, zoneId: null });
    expect(resolveDeliveryFee({ id: 'z1', district: 'GULU', feeUgx: 20_000, enabled: false }).confirmed).toBe(false);
  });

  it('rejects negative, fractional, and absurd fees', () => {
    expect(validateDeliveryZoneInput({ district: 'Kampala', feeUgx: -1 }).ok).toBe(false);
    expect(validateDeliveryZoneInput({ district: 'Kampala', feeUgx: 10.5 }).ok).toBe(false);
    expect(validateDeliveryZoneInput({ district: 'Kampala', feeUgx: 999_999_999 }).ok).toBe(false);
    expect(validateDeliveryZoneInput({ district: '', feeUgx: 1000 }).ok).toBe(false);
    const ok = validateDeliveryZoneInput({ district: ' kampala ', feeUgx: 5000 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.district).toBe('KAMPALA');
  });
});

// ---------- use case: server-authoritative totals ----------

describe('CheckoutUseCase (Slice 3B server-authoritative)', () => {
  it('prices every line from the catalogue — client prices are impossible to inject', async () => {
    const orders = fakeOrders();
    const uc = new CheckoutUseCase(orders, fakeProducts([fakeProduct('p1', 50_000)]), fakeZones([]));
    const result = await uc.execute({
      customerDetails: customer,
      buyerType: 'retail',
      // A malicious caller sending price/name/sku gets them ignored by the type
      // system and the implementation: only productId + quantity are read.
      items: [{ productId: 'p1', quantity: 2, price: 1, name: 'hacked' } as any],
    });
    expect(result.order.subtotalUgx).toBe(100_000);
    expect(result.order.items[0].price).toBe(50_000);
    expect(result.order.items[0].name).toBe('Product p1');
    expect(result.order.items[0].sku).toBe('SKU-p1');
  });

  it('rejects unknown products and products without a confirmed retail price', async () => {
    const uc = new CheckoutUseCase(fakeOrders(), fakeProducts([fakeProduct('p1', null)]), fakeZones([]));
    await expect(
      uc.execute({ customerDetails: customer, buyerType: 'retail', items: [{ productId: 'missing', quantity: 1 }] })
    ).rejects.toThrow(/PRODUCT_UNAVAILABLE/);
    await expect(
      uc.execute({ customerDetails: customer, buyerType: 'retail', items: [{ productId: 'p1', quantity: 1 }] })
    ).rejects.toThrow(/PRICE_UNAVAILABLE/);
  });

  it('rejects empty carts and invalid quantities', async () => {
    const uc = new CheckoutUseCase(fakeOrders(), fakeProducts([fakeProduct('p1', 1000)]), fakeZones([]));
    await expect(uc.execute({ customerDetails: customer, buyerType: 'retail', items: [] })).rejects.toThrow(/empty/);
    for (const quantity of [0, -1, 1.5, 100]) {
      await expect(
        uc.execute({ customerDetails: customer, buyerType: 'retail', items: [{ productId: 'p1', quantity }] })
      ).rejects.toThrow(/quantity/i);
    }
  });

  it('applies the configured delivery fee for the customer district', async () => {
    const uc = new CheckoutUseCase(
      fakeOrders(),
      fakeProducts([fakeProduct('p1', 10_000)]),
      fakeZones([{ id: 'z1', district: 'KAMPALA', feeUgx: 8_000, enabled: true }])
    );
    const result = await uc.execute({
      customerDetails: customer,
      buyerType: 'retail',
      items: [{ productId: 'p1', quantity: 1 }],
    });
    expect(result.deliveryFeeConfirmed).toBe(true);
    expect(result.order.deliveryFeeUgx).toBe(8_000);
    expect(result.order.totalUgx).toBe(18_000);
    expect(result.order.deliveryLocation?.district).toBe('Kampala');
  });

  it('keeps the fee truthful (0, unconfirmed) for unconfigured districts', async () => {
    const uc = new CheckoutUseCase(
      fakeOrders(),
      fakeProducts([fakeProduct('p1', 10_000)]),
      fakeZones([{ id: 'z1', district: 'KAMPALA', feeUgx: 8_000, enabled: true }])
    );
    const result = await uc.execute({
      customerDetails: { ...customer, deliveryLocation: { district: 'Moroto' } },
      buyerType: 'retail',
      items: [{ productId: 'p1', quantity: 1 }],
    });
    expect(result.deliveryFeeConfirmed).toBe(false);
    expect(result.order.deliveryFeeUgx).toBe(0);
    expect(result.order.totalUgx).toBe(10_000);
  });

  it('is idempotent on clientOrderKey — a resubmission returns the same order', async () => {
    const orders = fakeOrders();
    const uc = new CheckoutUseCase(orders, fakeProducts([fakeProduct('p1', 10_000)]), fakeZones([]));
    const input = {
      customerDetails: customer,
      buyerType: 'retail' as const,
      items: [{ productId: 'p1', quantity: 1 }],
      clientOrderKey: 'ck-abc-123-xyz',
    };
    const first = await uc.execute(input);
    const second = await uc.execute(input);
    expect(second.idempotentReplay).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(orders.saved.length).toBe(1);
  });

  it('still routes wholesale and corporate orders to owner review', async () => {
    const uc = new CheckoutUseCase(fakeOrders(), fakeProducts([fakeProduct('p1', 10_000)]), fakeZones([]));
    const result = await uc.execute({
      customerDetails: customer,
      buyerType: 'wholesale',
      items: [{ productId: 'p1', quantity: 1 }],
    });
    expect(result.order.orderStatus).toBe('pending_owner_review');
  });
});
