import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { orders } from '../schema/commerce';
import { IOrderRiskRepository } from '../../../application/ports/IOrderRiskRepository';

export class DrizzleOrderRiskRepository implements IOrderRiskRepository {
  async countOrdersByPhoneSince(phone: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.customerPhone, phone), gte(orders.createdAt, since)));
    return Number(row?.count ?? 0);
  }
}
