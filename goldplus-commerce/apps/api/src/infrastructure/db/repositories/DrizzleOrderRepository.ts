import { db } from '../client';
import { orders, orderItems } from '../schema/commerce';
import { products } from '../schema/products';
import { and, eq, desc } from 'drizzle-orm';
import { Order, OrderStatus as DomainOrderStatus, PaymentStatus as DomainPaymentStatus, BuyerType } from '../../../domain/commerce/Order';
import { ICustomerOrderRepository } from '../../../application/ports/ICustomerOrderRepository';
import { OrderDetailDto, OrderSummaryDto, OrderStatus, PaymentStatus } from '@goldplus/shared';

export class DrizzleOrderRepository implements ICustomerOrderRepository {
  async findById(id: string): Promise<Order | null> {
    const result = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      with: {
        items: true,
      },
    });

    if (!result) return null;

    return new Order(
      result.id,
      result.orderNumber,
      result.customerName,
      result.customerPhone,
      result.customerEmail ?? undefined,
      result.deliveryArea,
      result.deliveryAddress,
      result.buyerType as BuyerType,
      (result as any).items.map((item: any) => ({
        productId: item.productId,
        sku: item.sku,
        name: item.productName,
        price: item.unitPrice,
        quantity: item.quantity,
      })),
      result.subtotalAmount,
      result.deliveryFee,
      result.totalAmount,
      result.paymentStatus as DomainPaymentStatus,
      result.status as DomainOrderStatus,
      result.createdAt,
      result.updatedAt
    );
  }

  async findAll(): Promise<Order[]> {
    const results = await db.query.orders.findMany({
      orderBy: [desc(orders.createdAt)],
      with: {
        items: true,
      }
    });

    return results.map(result => new Order(
      result.id,
      result.orderNumber,
      result.customerName,
      result.customerPhone,
      result.customerEmail ?? undefined,
      result.deliveryArea,
      result.deliveryAddress,
      result.buyerType as BuyerType,
      (result as any).items.map((item: any) => ({
        productId: item.productId,
        sku: item.sku,
        name: item.productName,
        price: item.unitPrice,
        quantity: item.quantity,
      })),
      result.subtotalAmount,
      result.deliveryFee,
      result.totalAmount,
      result.paymentStatus as DomainPaymentStatus,
      result.status as DomainOrderStatus,
      result.createdAt,
      result.updatedAt
    ));
  }

  async save(order: Order): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: order.id,
        orderNumber: order.orderNumber,
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
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
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
        });
      }
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
      paymentStatus: row.paymentStatus as PaymentStatus,
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
      paymentStatus: row.paymentStatus as PaymentStatus,
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
