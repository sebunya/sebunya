import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { orders, orderItems } from '../schema/commerce';
import { outboxEvents } from '../schema/system';
import { notificationAttempts } from '../schema/phase11';
import {
  IDashboardReadRepository,
  CommerceSnapshot,
  SystemHealthSnapshot,
} from '../../../application/ports/IDashboardReadRepository';

const TOP_PRODUCTS_LIMIT = 5;

export class DrizzleDashboardReadRepository implements IDashboardReadRepository {
  async getCommerceSnapshot(since: Date): Promise<CommerceSnapshot> {
    const [totals] = await db
      .select({
        orderCount: sql<number>`count(*)::int`,
        paidOrderCount: sql<number>`count(*) filter (where ${orders.paymentStatus} = 'paid')::int`,
        paidRevenue: sql<number>`coalesce(sum(${orders.totalAmount}) filter (where ${orders.paymentStatus} = 'paid'), 0)::int`,
      })
      .from(orders)
      .where(gte(orders.createdAt, since));

    const topProducts = await db
      .select({
        productName: orderItems.productName,
        sku: orderItems.sku,
        quantity: sql<number>`sum(${orderItems.quantity})::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(gte(orders.createdAt, since))
      .groupBy(orderItems.productName, orderItems.sku)
      .orderBy(desc(sql`sum(${orderItems.quantity})`))
      .limit(TOP_PRODUCTS_LIMIT);

    return {
      orderCount: Number(totals?.orderCount ?? 0),
      paidOrderCount: Number(totals?.paidOrderCount ?? 0),
      paidRevenue: Number(totals?.paidRevenue ?? 0),
      topProducts: topProducts.map((p) => ({
        productName: p.productName,
        sku: p.sku,
        quantity: Number(p.quantity),
      })),
    };
  }

  async getSystemHealthSnapshot(since: Date): Promise<SystemHealthSnapshot> {
    const [outbox] = await db
      .select({ pending: sql<number>`count(*)::int` })
      .from(outboxEvents)
      .where(eq(outboxEvents.isProcessed, false));

    const [failures] = await db
      .select({ failed: sql<number>`count(*)::int` })
      .from(notificationAttempts)
      .where(and(eq(notificationAttempts.status, 'FAILED'), gte(notificationAttempts.attemptedAt, since)));

    return {
      pendingOutboxEvents: Number(outbox?.pending ?? 0),
      failedNotifications: Number(failures?.failed ?? 0),
    };
  }
}
