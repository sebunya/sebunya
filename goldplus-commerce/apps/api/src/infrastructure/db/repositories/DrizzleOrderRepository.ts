import { db } from '../client';
import { orders, orderItems } from '../schema/commerce';
import { eq, desc } from 'drizzle-orm';
import { Order, OrderStatus, PaymentStatus, BuyerType } from '../../../domain/commerce/Order';

export class DrizzleOrderRepository {
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
      result.paymentStatus as PaymentStatus,
      result.status as OrderStatus,
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
      result.paymentStatus as PaymentStatus,
      result.status as OrderStatus,
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
}
