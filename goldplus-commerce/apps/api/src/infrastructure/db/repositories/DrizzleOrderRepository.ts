import { db } from '../client';
import { orders, orderItems } from '../schema/commerce';
import { eq } from 'drizzle-orm';
import { Order, OrderStatus, PaymentStatus } from '../../../domain/commerce/Order';

export class DrizzleOrderRepository {
  async findById(id: string): Promise<Order | null> {
    const result = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      with: {
        items: true,
      },
    });

    if (!result) return null;

    // Mapping schema status to domain status
    // Note: This needs careful mapping if domain and schema diverge
    return new Order(
      result.id,
      result.userId || 'guest',
      (result as any).items.map((item: any) => ({
        productId: item.productId,
        name: 'Item', // Schema doesn't store name in order_items, usually joined from products
        price: item.unitPrice,
        quantity: item.quantity,
      })),
      result.totalAmount,
      result.status as OrderStatus,
      'unpaid', // Placeholder mapping
      result.createdAt,
      {
        name: 'Customer',
        email: result.customerEmail || '',
        phone: result.customerPhone || '',
      }
    );
  }

  async save(order: Order): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: order.id,
        orderNumber: `ORD-${order.id.substring(0, 8)}`,
        userId: order.customerId === 'guest' ? null : order.customerId,
        status: order.status,
        totalAmount: order.total,
        customerEmail: order.customerDetails.email,
        customerPhone: order.customerDetails.phone,
      }).onConflictDoUpdate({
        target: orders.id,
        set: {
          status: order.status,
          totalAmount: order.total,
        }
      });

      // Simple implementation: delete and re-insert items for now
      await tx.delete(orderItems).where(eq(orderItems.orderId, order.id));
      
      for (const item of order.items) {
        await tx.insert(orderItems).values({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.price,
        });
      }
    });
  }
}
