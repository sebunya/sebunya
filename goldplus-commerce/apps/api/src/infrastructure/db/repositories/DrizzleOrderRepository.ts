import { db } from '../client';
import { orders, orderItems , checkoutIdempotency } from '../schema/commerce';
import { pricingQuotes, promotionRedemptions, promotionReservations } from '../schema/pricing';
import { products } from '../schema/products';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { Order, OrderStatus as DomainOrderStatus, PaymentStatus, BuyerType } from '../../../domain/commerce/Order';
import type { ITransactionalPricedOrderRepository } from '../../../application/use-cases/commerce/CheckoutUseCase';
import { PricingQuote } from '../../../domain/pricing/PricingEvaluator';
import { decodePricingJsonb, encodePricingJsonb } from '../PricingJsonbCodec';
import { ICustomerOrderRepository } from '../../../application/ports/ICustomerOrderRepository';
import { OrderDetailDto, OrderSummaryDto, OrderStatus } from '@goldplus/shared';

export class DrizzleOrderRepository implements ICustomerOrderRepository, ITransactionalPricedOrderRepository {
  private hydrate(result: typeof orders.$inferSelect & { items: Array<typeof orderItems.$inferSelect> }): Order {
    const pricing = result.pricingSnapshot ? decodePricingJsonb<any>(result.pricingSnapshot) : null;
    if (pricing?.evaluatedAt && !(pricing.evaluatedAt instanceof Date)) pricing.evaluatedAt = new Date(pricing.evaluatedAt);
    return new Order(
      result.id, result.orderNumber, result.customerName, result.customerPhone, result.customerEmail ?? undefined,
      result.deliveryArea, result.deliveryAddress, result.buyerType as BuyerType,
      result.items.map((item) => ({ productId: item.productId, sku: item.sku, name: item.productName, price: item.unitPrice, quantity: item.quantity, canonicalUnitPrice: item.canonicalUnitPrice, baseSubtotal: item.baseSubtotal, discountAmount: item.discountAmount, finalLineTotal: item.finalLineTotal })),
      result.subtotalAmount, result.deliveryFee, result.totalAmount, result.paymentStatus as PaymentStatus,
      result.status as DomainOrderStatus, result.createdAt, result.updatedAt, (result.deliveryLocation as any) ?? null,
      result.deliveryFeeConfirmed ?? false, pricing, result.userId ?? null
    );
  }
  async findById(id: string): Promise<Order | null> {
    const isUuid = id.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
    const result = await db.query.orders.findFirst({
      where: isUuid ? eq(orders.id, id) : eq(orders.orderNumber, id),
      with: {
        items: true,
      },
    });

    if (!result) return null;

    return this.hydrate(result as typeof orders.$inferSelect & { items: Array<typeof orderItems.$inferSelect> });
  }

  /** Server-owned paid-order facts used by the dormant Loyalty earn boundary. */
  async findLoyaltyEarnSource(id: string): Promise<{ userId: string; totalUgx: number } | null> {
    const [row] = await db.select({
      userId: orders.userId,
      totalUgx: orders.totalAmount,
      paymentStatus: orders.paymentStatus,
    }).from(orders).where(eq(orders.id, id)).limit(1);
    return row?.userId && row.paymentStatus === 'paid'
      ? { userId: row.userId, totalUgx: row.totalUgx }
      : null;
  }


  async findAll(): Promise<Order[]> {
    const results = await db.query.orders.findMany({
      orderBy: [desc(orders.createdAt)],
      with: {
        items: true,
      }
    });

    return results.map((result) => this.hydrate(result as typeof orders.$inferSelect & { items: Array<typeof orderItems.$inferSelect> }));
  }

  async save(order: Order, opts?: { clientOrderKey?: string | null }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId ?? null,
        buyerType: order.buyerType,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerEmail: order.customerEmail,
        deliveryArea: order.deliveryArea,
        deliveryAddress: order.deliveryAddress,
        status: order.orderStatus,
        paymentStatus: order.paymentStatus,
        subtotalAmount: order.subtotalUgx,
        deliveryFee: order.deliveryFeeUgx,
        totalAmount: order.totalUgx,
        pricingQuoteId: order.pricingSnapshot?.quoteId ?? null,
        pricingCurrency: order.pricingSnapshot?.currency ?? 'UGX',
        pricingBaseSubtotal: order.pricingSnapshot?.baseSubtotalUgx ?? order.subtotalUgx,
        pricingDiscountTotal: order.pricingSnapshot?.discountTotalUgx ?? 0,
        pricingTaxTotal: order.pricingSnapshot?.taxUgx ?? 0,
        pricingCalculationVersion: order.pricingSnapshot?.calculationVersion ?? 'legacy-unadjusted-v1',
        pricingSnapshot: order.pricingSnapshot ? encodePricingJsonb(order.pricingSnapshot as any) as any : null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        deliveryLocation: order.deliveryLocation ?? null,
        deliveryFeeConfirmed: order.deliveryFeeConfirmed,
        clientOrderKey: opts?.clientOrderKey ?? null,
      }).onConflictDoUpdate({
        target: orders.id,
        set: {
          status: order.orderStatus,
          paymentStatus: order.paymentStatus,
          updatedAt: new Date(),
        }
      });

      await tx.delete(orderItems).where(eq(orderItems.orderId, order.id));
      
      for (const item of order.items) {
        await tx.insert(orderItems).values({
          orderId: order.id,
          productId: item.productId,
          sku: item.sku,
          productName: item.name,
          quantity: item.quantity,
          unitPrice: item.price,
          canonicalUnitPrice: item.canonicalUnitPrice ?? item.price,
          baseSubtotal: item.baseSubtotal ?? item.price * item.quantity,
          discountAmount: item.discountAmount ?? 0,
          finalLineTotal: item.finalLineTotal ?? item.price * item.quantity,
        });
      }
    });
  }

  /**
   * Persists the order and, in the SAME transaction, links it to its checkout
   * claim under the active fence.
   *
   * These were two statements: commit the order, then link it. A crash in that
   * window left a committed order with an IN_PROGRESS claim holding no order id,
   * so a later takeover re-priced, re-reserved and re-created — duplicating the
   * order the customer already had. Narrowing the window is not a fix; the two
   * writes have to be one commit.
   *
   * If the fenced link affects zero rows this worker has lost the lease, and the
   * throw rolls the order back. The invariant is therefore: either nothing
   * committed, or exactly one order durably linked to one checkout operation.
   */
  async savePricedOrder(input: {
    order: Order;
    quote: PricingQuote;
    reservationIds: string[];
    clientOrderKey: string | null;
    checkoutLink?: { identity: string; claimToken: string; fencingNumber: number };
  }): Promise<{ order: Order; duplicate: boolean }> {
    if (!input.order.pricingSnapshot || input.order.pricingSnapshot.quoteId !== input.quote.id || input.order.totalUgx !== input.quote.finalTotalUgx) throw new Error('PRICING_ORDER_SNAPSHOT_MISMATCH');
    return db.transaction(async (tx) => {
      if (input.clientOrderKey) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.clientOrderKey}, 0))`);
      if (input.clientOrderKey) {
        const [existing] = await tx.select().from(orders).where(eq(orders.clientOrderKey, input.clientOrderKey)).limit(1);
        if (existing) {
          const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, existing.id));
          return { order: this.hydrate({ ...existing, items }), duplicate: true };
        }
      }
      const [persistedQuote] = await tx.select().from(pricingQuotes).where(eq(pricingQuotes.id, input.quote.id)).limit(1);
      if (!persistedQuote || persistedQuote.expiresAt <= new Date() || persistedQuote.currency !== input.quote.currency || persistedQuote.baseSubtotalUgx !== input.quote.baseSubtotalUgx || persistedQuote.discountTotalUgx !== input.quote.discountTotalUgx || persistedQuote.shippingUgx !== input.quote.shippingUgx || persistedQuote.taxUgx !== input.quote.taxUgx || persistedQuote.finalTotalUgx !== input.quote.finalTotalUgx || persistedQuote.calculationVersion !== input.quote.calculationVersion) throw new Error('PRICING_QUOTE_COMMIT_MISMATCH');
      const initialReservations = input.reservationIds.length ? await tx.select().from(promotionReservations).where(inArray(promotionReservations.id, input.reservationIds)) : [];
      for (const versionId of [...new Set(initialReservations.map((row) => row.promotionVersionId))].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${versionId}, 0))`);
      const reservations = input.reservationIds.length ? await tx.select().from(promotionReservations).where(inArray(promotionReservations.id, input.reservationIds)) : [];
      if (reservations.length !== input.reservationIds.length || reservations.some((row) => row.quoteId !== input.quote.id || row.status !== 'RESERVED' || row.expiresAt <= new Date())) throw new Error('PRICING_RESERVATION_COMMIT_MISMATCH');
      await tx.insert(orders).values({
        id: input.order.id, orderNumber: input.order.orderNumber, userId: input.order.userId ?? null, buyerType: input.order.buyerType,
        customerName: input.order.customerName, customerPhone: input.order.customerPhone, customerEmail: input.order.customerEmail,
        deliveryArea: input.order.deliveryArea, deliveryAddress: input.order.deliveryAddress, status: input.order.orderStatus,
        paymentStatus: input.order.paymentStatus, subtotalAmount: input.order.subtotalUgx, deliveryFee: input.order.deliveryFeeUgx,
        totalAmount: input.order.totalUgx, createdAt: input.order.createdAt, updatedAt: input.order.updatedAt,
        deliveryLocation: input.order.deliveryLocation ?? null, deliveryFeeConfirmed: input.order.deliveryFeeConfirmed,
        clientOrderKey: input.clientOrderKey, pricingQuoteId: input.quote.id, pricingCurrency: input.quote.currency,
        pricingBaseSubtotal: input.quote.baseSubtotalUgx, pricingDiscountTotal: input.quote.discountTotalUgx,
        pricingTaxTotal: input.quote.taxUgx, pricingCalculationVersion: input.quote.calculationVersion,
        pricingSnapshot: encodePricingJsonb(input.order.pricingSnapshot as any) as any,
      });

      // Same transaction as the insert above. A zero-row result means the lease
      // was taken over while this worker was pricing; the throw rolls the order
      // back rather than leaving it orphaned.
      if (input.checkoutLink) {
        const linked = await tx
          .update(checkoutIdempotency)
          .set({ orderId: input.order.id, stage: 'ORDER_CREATED', updatedAt: new Date() })
          .where(
            and(
              eq(checkoutIdempotency.identity, input.checkoutLink.identity),
              eq(checkoutIdempotency.claimToken, input.checkoutLink.claimToken),
              eq(checkoutIdempotency.fencingNumber, input.checkoutLink.fencingNumber),
              eq(checkoutIdempotency.state, 'IN_PROGRESS'),
            ),
          )
          .returning({ identity: checkoutIdempotency.identity });
        if (linked.length !== 1) throw new Error('CHECKOUT_LEASE_LOST');
      }
      await tx.insert(orderItems).values(input.order.items.map((item) => ({ orderId: input.order.id, productId: item.productId, sku: item.sku, productName: item.name, quantity: item.quantity, unitPrice: item.price, canonicalUnitPrice: item.canonicalUnitPrice ?? item.price, baseSubtotal: item.baseSubtotal ?? item.price * item.quantity, discountAmount: item.discountAmount ?? 0, finalLineTotal: item.finalLineTotal ?? item.price * item.quantity })));
      if (reservations.length) {
        await tx.insert(promotionRedemptions).values(reservations.map((reservation) => ({ reservationId: reservation.id, orderId: input.order.id, redeemedAt: new Date() })));
        await tx.update(promotionReservations).set({ status: 'REDEEMED', updatedAt: new Date() }).where(inArray(promotionReservations.id, reservations.map((row) => row.id)));
      }
      return { order: input.order, duplicate: false };
    });
  }

  // ICustomerOrderRepository Implementation
  async listForUser(userId: string): Promise<OrderSummaryDto[]> {
    const rows = await db.query.orders.findMany({
      where: eq(orders.userId, userId),
      with: { items: true },
      orderBy: [desc(orders.createdAt)],
      limit: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status as OrderStatus,
      totalAmountUgx: row.totalAmount,
      itemCount: (row as any).items?.length ?? 0,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async findByIdForUser(orderId: string, userId: string): Promise<OrderDetailDto | null> {
    const row = await db.query.orders.findFirst({
      where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
      with: { items: true },
    });
    if (!row) return null;

    const productIds = ((row as any).items ?? []).map((i: any) => i.productId).filter(Boolean);
    const productRows = productIds.length
      ? await db.query.products.findMany({ where: (p, { inArray }) => inArray(p.id, productIds) })
      : [];
    const productById = new Map(productRows.map((p) => [p.id, p]));

    return {
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status as OrderStatus,
      totalAmountUgx: row.totalAmount,
      createdAt: row.createdAt.toISOString(),
      items: ((row as any).items ?? []).map((i: any) => {
        const product = productById.get(i.productId);
        return {
          productId: i.productId,
          productName: product?.name ?? 'Product no longer available',
          productSlug: product?.slug ?? null,
          unitPriceUgx: i.unitPrice,
          quantity: i.quantity,
        };
      }),
      customer: {
        email: row.customerEmail ?? null,
        phone: row.customerPhone ?? null,
      },
    };
  }
}
