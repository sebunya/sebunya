import { Order, OrderItem, BuyerType, OrderDeliveryLocation } from '../../../domain/commerce/Order';
import { normalizeDistrict, resolveDeliveryFee } from '../../../domain/commerce/DeliveryFee';
import { IProductRepository } from '../../ports/IProductRepository';
import { IDeliveryZoneRepository } from '../../ports/IDeliveryZoneRepository';

export interface IOrderRepository {
  save(order: Order, opts?: { clientOrderKey?: string | null }): Promise<void>;
  findById(id: string): Promise<Order | null>;
  /** Idempotency: find an order previously created with this client key. */
  findByClientKey?(clientOrderKey: string): Promise<Order | null>;
}

export interface CheckoutDto {
  customerDetails: {
    name: string;
    email?: string;
    phone: string;
    deliveryArea: string;
    deliveryAddress: string;
    /** Structured Uganda location from the picker (Slice 3B). */
    deliveryLocation?: OrderDeliveryLocation | null;
  };
  buyerType: BuyerType;
  /**
   * Server-authoritative pricing (Slice 3B): only productId and quantity are
   * trusted from the client. Any client-sent price, sku, or name is ignored —
   * the catalogue is the sole source of prices.
   */
  items: Array<{
    productId: string;
    quantity: number;
  }>;
  /** Optional idempotency key: repeated submissions return the same order. */
  clientOrderKey?: string | null;
}

export interface CheckoutResult {
  order: Order;
  /** True only when the delivery fee came from a configured enabled zone. */
  deliveryFeeConfirmed: boolean;
  /** True when an existing order was returned for a repeated clientOrderKey. */
  idempotentReplay: boolean;
}

const MAX_LINE_ITEMS = 50;
const MAX_QUANTITY_PER_LINE = 99;

export class CheckoutUseCase {
  constructor(
    private readonly orderRepo: IOrderRepository,
    private readonly products: IProductRepository,
    private readonly deliveryZones: IDeliveryZoneRepository | null = null
  ) {}

  public async execute(dto: CheckoutDto): Promise<CheckoutResult> {
    if (!dto.items || dto.items.length === 0) {
      throw new Error('Cannot process empty checkout');
    }
    if (dto.items.length > MAX_LINE_ITEMS) {
      throw new Error(`Too many line items (max ${MAX_LINE_ITEMS})`);
    }

    // Idempotent replay: a repeated submission must not create a second order.
    const clientOrderKey = dto.clientOrderKey?.trim() || null;
    if (clientOrderKey && this.orderRepo.findByClientKey) {
      const existing = await this.orderRepo.findByClientKey(clientOrderKey);
      if (existing) {
        return { order: existing, deliveryFeeConfirmed: existing.deliveryFeeConfirmed, idempotentReplay: true };
      }
    }

    for (const item of dto.items) {
      if (!item.productId || typeof item.productId !== 'string') {
        throw new Error('Every item needs a product id');
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_LINE) {
        throw new Error(`Item quantity must be a whole number between 1 and ${MAX_QUANTITY_PER_LINE}`);
      }
    }

    // Server-authoritative pricing: resolve every line from the public catalogue.
    const ids = [...new Set(dto.items.map((i) => i.productId))];
    const rows = await this.products.findPublicViewList({ ids, limit: ids.length });
    const byId = new Map(rows.map((r) => [r.entity.id, r]));

    const orderItems: OrderItem[] = dto.items.map((i) => {
      const row = byId.get(i.productId);
      if (!row) {
        throw new Error('PRODUCT_UNAVAILABLE: One of the items is no longer available for purchase.');
      }
      const price = row.retailPriceUgx;
      if (price == null || !Number.isInteger(price) || price <= 0) {
        throw new Error('PRICE_UNAVAILABLE: One of the items has no confirmed retail price. Please request a quote.');
      }
      return {
        productId: row.entity.id,
        sku: row.entity.sku,
        name: row.entity.name,
        price,
        quantity: i.quantity,
      };
    });

    // Delivery fee from configured zones; unconfigured districts stay truthful (0, unconfirmed).
    const district = dto.customerDetails.deliveryLocation?.district
      ? normalizeDistrict(dto.customerDetails.deliveryLocation.district)
      : null;
    const zone = district && this.deliveryZones ? await this.deliveryZones.findByDistrict(district) : null;
    const fee = resolveDeliveryFee(zone);

    const order = Order.create(
      crypto.randomUUID(),
      dto.customerDetails,
      dto.buyerType,
      orderItems,
      fee.feeUgx,
      fee.confirmed
    );

    // A unique index on the client key makes concurrent duplicate
    // submissions collapse to a single order.
    await this.orderRepo.save(order, clientOrderKey ? { clientOrderKey } : undefined);
    return { order, deliveryFeeConfirmed: fee.confirmed, idempotentReplay: false };
  }
}
