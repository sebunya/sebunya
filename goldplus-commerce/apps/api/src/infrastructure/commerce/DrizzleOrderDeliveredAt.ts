import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { IOrderDeliveredAt } from '../../application/ports/IOrderDeliveredAt';

export class DrizzleOrderDeliveredAt implements IOrderDeliveredAt {
  async deliveredAt(orderNumber: string): Promise<Date | null> {
    const result = await db.execute(sql`
      select max(e.occurred_at) as "at"
        from order_events e join orders o on o.id = e.order_id
       where o.order_number = ${orderNumber}
         and e.to_status in ('delivered', 'completed')
         and e.is_synthetic = false
    `);
    const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{ at?: Date | string | null }>;
    return rows[0]?.at ? new Date(rows[0].at) : null;
  }
}
