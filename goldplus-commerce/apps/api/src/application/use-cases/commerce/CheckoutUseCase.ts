import { Order, OrderItem, BuyerType, OrderDeliveryLocation, OrderPricingSnapshot } from '../../../domain/commerce/Order';
import { normalizeDistrict, resolveDeliveryFee } from '../../../domain/commerce/DeliveryFee';
import { IProductRepository } from '../../ports/IProductRepository';
import { IDeliveryZoneRepository } from '../../ports/IDeliveryZoneRepository';
import { EvaluateCartPricingUseCase } from '../pricing/EvaluateCartPricingUseCase';
import { ManagePromotionCapacityUseCase } from '../pricing/ManagePromotionCapacityUseCase';
import { IPricingQuoteRepository } from '../../ports/IPricingQuoteRepository';
import { PricingQuote } from '../../../domain/pricing/PricingEvaluator';

export interface IOrderRepository {
  save(order: Order, opts?: { clientOrderKey?: string | null }): Promise<void>;
  findById(id: string): Promise<Order | null>;
  /** Idempotency: find an order previously created with this client key. */
}

export interface ITransactionalPricedOrderRepository extends IOrderRepository {
  savePricedOrder(input: {
    order: Order;
    quote: PricingQuote;
    reservationIds: string[];
    clientOrderKey: string | null;
    /** Fenced link, written in the SAME transaction as the order insert. */
    checkoutLink?: { identity: string; claimToken: string; fencingNumber: number };
  }): Promise<{ order: Order; duplicate: boolean }>;
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
  /** Active checkout lease, so the order and its claim link commit together. */
  checkoutLink?: { identity: string; claimToken: string; fencingNumber: number };
  couponCode?: string | null;
  previewQuoteId?: string | null;
  acceptPriceChange?: boolean;
  /**
   * The verified checkout principal. USER links the order to that account —
   * the anchor for "my orders" and loyalty attribution; GUEST (or absent)
   * stores no identity. Never trusted from the client: it comes from the
   * signed checkout-intent claims.
   */
  principal?: { kind: 'USER' | 'GUEST'; id: string } | null;
  /** 'offline' = pay on delivery/collection — gates the PART I.2 COD rules. */
  paymentMethod?: 'pesapal' | 'offline' | null;
  /**
   * Loyalty points to redeem against this order (loyalty brief PART G).
   * Signed-in customers only; validated and reserved through the redemption
   * engine — unset programme config refuses with a clear message, never a
   * silent default.
   */
  redeemPoints?: number | null;
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
    private readonly deliveryZones: IDeliveryZoneRepository | null = null,
    private readonly authoritativePricing: {
      evaluator: EvaluateCartPricingUseCase;
      capacity: ManagePromotionCapacityUseCase;
      quotes: IPricingQuoteRepository;
      orders: ITransactionalPricedOrderRepository;
    } | null = null,
    private readonly codPolicy: {
      forDistrict(district: string): Promise<{
        zoneCode: string;
        active: boolean;
        codAllowed: boolean | null;
        codMaxOrderValueUgx: number | null;
        prepayRequiredAboveUgx: number | null;
      } | null>;
    } | null = null,
    private readonly checkoutSignals: {
      velocity(input: { phone: string; orderId: string }): Promise<void>;
    } | null = null,
    private readonly loyaltyRedemption: {
      reserve(input: { userId: string; points: number; orderGoodsTotalUgx: number; idempotencyKey: string }): Promise<
        { ok: true; reservationId: string; valueUgx: number } | { ok: false; code: string; message: string }
      >;
      attach(reservationId: string, orderId: string): Promise<void>;
      release(input: { reservationId: string }): Promise<unknown>;
    } | null = null,
    /**
     * THE quoting service (delivery brief, contract #1).
     *
     * Optional so the use case still constructs without it, but in production
     * it is always present and it answers FIRST. The legacy zone path below is
     * consulted only when this returns CONFIG_INCOMPLETE — every other reason
     * is a correct answer, and handing a correct answer to the legacy model
     * would replace it with a wrong one (it would happily price a lake island).
     *
     * When the fallback has served zero requests for the agreed period, both
     * legacy paths are deleted and contract #1 becomes true.
     */
    private readonly deliveryQuoting: {
      quote(input: {
        areaSlug?: string | null;
        deliveryArea?: string | null;
        district?: string | null;
        items: ReadonlyArray<{ productId: string; quantity: number }>;
      }): Promise<{
        feeUgx: number | null;
        confirmed: boolean;
        pricedBy: 'delivery_model' | 'bus_rate_card' | 'manual';
        mayFallBackToLegacy: boolean;
        capture: Record<string, unknown>;
      }>;
      recordQuote(orderId: string, capture: Record<string, unknown>): Promise<void>;
    } | null = null
  ) {}

  public async execute(dto: CheckoutDto): Promise<CheckoutResult> {
    if (!dto.items || dto.items.length === 0) {
      throw new Error('Cannot process empty checkout');
    }
    if (dto.items.length > MAX_LINE_ITEMS) {
      throw new Error(`Too many line items (max ${MAX_LINE_ITEMS})`);
    }

    // Idempotency is NOT handled here.
    //
    // This use case used to run its own lookup keyed on the caller's email or
    // phone plus the client order key. That was a second, contradictory
    // ownership model living alongside the checkout_idempotency record: one
    // keyed on caller-supplied contact details, the other on a verified
    // principal. Two mechanisms disagreeing about who owns an operation is worse
    // than either alone, because which one answers depends on call order.
    //
    // The single authoritative mechanism is the fenced checkout_idempotency
    // claim, taken before this use case is invoked. The customer scope below is
    // used only for pricing, never for ownership.
    const customerScopeKey =
      dto.customerDetails.email?.trim().toLowerCase() || dto.customerDetails.phone.trim();
    const clientOrderKey = dto.clientOrderKey?.trim() || null;

    for (const item of dto.items) {
      if (!item.productId || typeof item.productId !== 'string') {
        throw new Error('Every item needs a product id');
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_LINE) {
        throw new Error(`Item quantity must be a whole number between 1 and ${MAX_QUANTITY_PER_LINE}`);
      }
    }

    // Delivery fee from configured zones; unconfigured districts stay truthful (0, unconfirmed).
    const district = dto.customerDetails.deliveryLocation?.district
      ? normalizeDistrict(dto.customerDetails.deliveryLocation.district)
      : null;
    const zone = district && this.deliveryZones ? await this.deliveryZones.findByDistrict(district) : null;

    // THE quoting service answers first. The legacy zone path is a fallback for
    // CONFIG_INCOMPLETE and nothing else.
    let fee = resolveDeliveryFee(zone);
    let deliveryCapture: Record<string, unknown> | null = null;
    if (this.deliveryQuoting) {
      const quoted = await this.deliveryQuoting.quote({
        areaSlug: dto.customerDetails.deliveryLocation?.areaSlug ?? null,
        deliveryArea: dto.customerDetails.deliveryArea ?? null,
        district: dto.customerDetails.deliveryLocation?.district ?? null,
        items: dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      });
      deliveryCapture = { ...quoted.capture, pricedBy: quoted.pricedBy };
      if (!quoted.mayFallBackToLegacy) {
        // A real answer, including a truthful "we cannot price this".
        fee = { feeUgx: quoted.feeUgx ?? 0, confirmed: quoted.confirmed, zoneId: zone?.id ?? null };
      } else {
        // Config incomplete: the legacy path answers THIS request only, and the
        // capture records that it did so the fallback rate is measurable.
        deliveryCapture = { ...deliveryCapture, pricedBy: 'legacy_fallback' };
      }
    }

    // COD controls (location brief I.2): eligibility is a ZONE attribute. Only
    // an ACTIVE zone policy gates — an unset policy blocks nothing (and cannot
    // be active with unset values). Above the zone's COD ceiling, prepayment is
    // required: refused with a clear message, never silently converted.
    if (dto.paymentMethod === 'offline' && district && this.codPolicy) {
      const policy = await this.codPolicy.forDistrict(district);
      if (policy?.active) {
        if (policy.codAllowed === false) {
          throw new Error('COD_NOT_AVAILABLE: Pay on delivery is not available for this destination — pay online to order.');
        }
      }
    }

    if (this.authoritativePricing) {
      const quote = await this.authoritativePricing.evaluator.execute({
        items: dto.items,
        couponCode: dto.couponCode,
        customerScopeKey,
        customerDnaSegments: [],
        experimentEvidence: [],
        shippingUgx: fee.feeUgx,
        taxUgx: 0,
        persist: true,
      });
      if (dto.previewQuoteId) {
        const preview = await this.authoritativePricing.quotes.findQuote(dto.previewQuoteId);
        if (!preview || preview.expiresAt <= quote.evaluatedAt) throw new Error('PRICE_CHANGED: The preview quote expired or is unavailable. Review the current price.');
        const baseChanged = preview.baseSubtotalUgx !== quote.baseSubtotalUgx || preview.lines.some((line, index) => line.canonicalUnitPriceUgx !== quote.lines[index]?.canonicalUnitPriceUgx || line.quantity !== quote.lines[index]?.quantity);
        const promotionChanged = preview.discountTotalUgx !== quote.discountTotalUgx || preview.finalTotalUgx !== quote.finalTotalUgx || preview.appliedPromotionVersions.map((item) => item.versionId).join(',') !== quote.appliedPromotionVersions.map((item) => item.versionId).join(',');
        if (!dto.acceptPriceChange && (baseChanged || promotionChanged)) throw new Error(`${baseChanged ? 'PRICE_CHANGED' : 'PROMOTION_CHANGED'}: The authoritative checkout total differs from the preview. Review and confirm the revised breakdown.`);
      }
      const checkoutKey = clientOrderKey ?? `quote:${quote.id}`;

      // Loyalty redemption (PART G): reserve BEFORE the order exists so an
      // insufficient balance or unset programme config fails the checkout with
      // a clear message instead of an order carrying a broken discount.
      let loyaltyReservation: { reservationId: string; valueUgx: number } | null = null;
      if (dto.redeemPoints && dto.redeemPoints > 0) {
        if (!this.loyaltyRedemption || dto.principal?.kind !== 'USER') {
          throw new Error('REDEMPTION_UNAVAILABLE: Sign in to redeem points.');
        }
        const goodsTotalUgx = quote.finalTotalUgx - quote.shippingUgx - quote.taxUgx;
        const reserveResult = await this.loyaltyRedemption.reserve({
          userId: dto.principal.id,
          points: dto.redeemPoints,
          orderGoodsTotalUgx: goodsTotalUgx,
          idempotencyKey: checkoutKey,
        });
        if (!reserveResult.ok) {
          throw new Error(`${reserveResult.code}: ${reserveResult.message}`);
        }
        loyaltyReservation = { reservationId: reserveResult.reservationId, valueUgx: reserveResult.valueUgx };
      }

      const reservation = await this.authoritativePricing.capacity.reserve({ quoteId: quote.id, checkoutKey });
      const snapshot: OrderPricingSnapshot = {
        quoteId: quote.id,
        currency: quote.currency,
        baseSubtotalUgx: quote.baseSubtotalUgx,
        discountTotalUgx: quote.discountTotalUgx,
        shippingUgx: quote.shippingUgx,
        taxUgx: quote.taxUgx,
        finalTotalUgx: quote.finalTotalUgx,
        calculationVersion: quote.calculationVersion,
        couponReference: quote.couponReference,
        appliedPromotionVersions: quote.appliedPromotionVersions,
        experimentEvidence: quote.experimentEvidence,
        adjustments: quote.adjustments,
        evaluatedAt: quote.evaluatedAt,
      };
      const pricedItems: OrderItem[] = quote.lines.map((line) => ({ productId: line.productId, sku: line.sku, name: line.name, price: line.canonicalUnitPriceUgx, quantity: line.quantity, canonicalUnitPrice: line.canonicalUnitPriceUgx, baseSubtotal: line.baseSubtotalUgx, discountAmount: line.discountUgx, finalLineTotal: line.finalSubtotalUgx }));
      if (dto.paymentMethod === 'offline' && district && this.codPolicy) {
        const policy = await this.codPolicy.forDistrict(district);
        const payable = quote.finalTotalUgx - (loyaltyReservation?.valueUgx ?? 0);
        if (policy?.active && policy.codMaxOrderValueUgx !== null && payable > policy.codMaxOrderValueUgx) {
          throw new Error(
            `COD_LIMIT_EXCEEDED: Orders above ${policy.codMaxOrderValueUgx.toLocaleString('en-UG')} UGX to this zone must be paid online.`,
          );
        }
      }

      const order = Order.create(
        crypto.randomUUID(),
        dto.customerDetails,
        dto.buyerType,
        pricedItems,
        quote.shippingUgx,
        fee.confirmed,
        snapshot,
        dto.principal?.kind === 'USER' ? dto.principal.id : null,
        loyaltyReservation ? { discountUgx: loyaltyReservation.valueUgx, redemptionId: loyaltyReservation.reservationId } : null,
      );
      try {
        const saved = await this.authoritativePricing.orders.savePricedOrder({ order, quote, reservationIds: reservation.reservations.map((item) => item.id), clientOrderKey, checkoutLink: dto.checkoutLink });
        if (saved.duplicate && reservation.reservations.length) await this.authoritativePricing.capacity.release({ quoteId: quote.id });
        if (loyaltyReservation && this.loyaltyRedemption) {
          if (saved.duplicate) {
            // The replayed order already carries (or never had) a redemption —
            // this fresh reservation must not linger against the balance.
            await this.loyaltyRedemption.release({ reservationId: loyaltyReservation.reservationId }).catch(() => undefined);
          } else {
            await this.loyaltyRedemption.attach(loyaltyReservation.reservationId, saved.order.id);
          }
        }
        if (!saved.duplicate && this.checkoutSignals) {
          // Fraud velocity (location brief I.3 / loyalty brief PART N):
          // fire-and-forget — a signal write can never fail a checkout.
          void this.checkoutSignals
            .velocity({ phone: dto.customerDetails.phone, orderId: saved.order.id })
            .catch(() => undefined);
        }
        if (deliveryCapture && this.deliveryQuoting) {
          // Never fatal: a capture that fails must not void a real order. It is
          // an observation the model loses, and the ops queue surfaces that.
          await this.deliveryQuoting.recordQuote(saved.order.id, deliveryCapture).catch(() => undefined);
        }
        return { order: saved.order, deliveryFeeConfirmed: saved.order.deliveryFeeConfirmed, idempotentReplay: saved.duplicate };
      } catch (error) {
        if (reservation.reservations.length) await this.authoritativePricing.capacity.release({ quoteId: quote.id }).catch(() => undefined);
        if (loyaltyReservation && this.loyaltyRedemption) {
          await this.loyaltyRedemption.release({ reservationId: loyaltyReservation.reservationId }).catch(() => undefined);
        }
        throw error;
      }
    }

    // Legacy test/fallback composition: resolve every line from the public catalogue.
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
    if (deliveryCapture && this.deliveryQuoting) {
      await this.deliveryQuoting.recordQuote(order.id, deliveryCapture).catch(() => undefined);
    }
    return { order, deliveryFeeConfirmed: fee.confirmed, idempotentReplay: false };
  }
}
