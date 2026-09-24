import { sql } from 'drizzle-orm';
import { db } from '../client';
import { ICommerceReconciliationRepository } from '../../../application/ports/ICommerceReconciliationRepository';
import { OrderMoneyRow, InventoryRow, OrderStockRow } from '../../../domain/commerce/CommerceIntegrity';

/** bigint/numeric come back from the driver as strings; money stays exact to 2^53. */
const num = (v: unknown): number => Number(v ?? 0);

export class DrizzleCommerceReconciliationRepository implements ICommerceReconciliationRepository {
  async scanOrderMoney(limit: number): Promise<OrderMoneyRow[]> {
    const rows = (await db.execute(sql`
      select o.id as order_id,
             o.total_amount as total_amount,
             o.subtotal_amount as subtotal_amount,
             o.delivery_fee as delivery_fee,
             o.loyalty_discount_ugx as loyalty_discount,
             coalesce(sum(oi.final_line_total), 0) as line_items_sum
      from orders o
      left join order_items oi on oi.order_id = o.id
      group by o.id, o.total_amount, o.subtotal_amount, o.delivery_fee, o.loyalty_discount_ugx
      order by o.created_at desc
      limit ${limit}
    `)) as unknown as any[];
    return rows.map((r) => ({
      orderId: String(r.order_id),
      totalAmount: num(r.total_amount),
      subtotalAmount: num(r.subtotal_amount),
      deliveryFee: num(r.delivery_fee),
      loyaltyDiscount: num(r.loyalty_discount),
      lineItemsSum: num(r.line_items_sum),
    }));
  }

  async scanOrderStock(limit: number): Promise<OrderStockRow[]> {
    // Only orders that could be an exception: goods left (or the task is past
    // packing) while a row is still reserved, or cancelled with a consumed row.
    // A cancelled-after-consume order is reported for 7 days only: nothing
    // can clear it (a return is recorded as a stock adjustment, which names no
    // order), and the alert runs every tick, so an unbounded report would shout
    // about the same finished case forever. The cancel itself also writes an
    // INVENTORY_RETURN_NEEDED audit row, which stays.
    const rows = (await db.execute(sql`
      select o.id as order_id,
             o.status as order_status,
             t.status as task_status,
             count(*) filter (where r.status = 'reserved') as reserved_rows,
             count(*) filter (where r.status = 'consumed') as consumed_rows
      from orders o
      join inventory_reservations r on r.order_id = o.id
      left join fulfilment_tasks t on t.order_id = o.id
      where o.status in ('dispatched', 'delivered', 'completed', 'cancelled')
         or t.status in ('READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED')
      group by o.id, o.status, t.status
      having count(*) filter (where r.status = 'reserved') > 0
          or (o.status = 'cancelled' and max(o.updated_at) > now() - interval '7 days'
              and count(*) filter (where r.status = 'consumed') > 0)
      order by max(o.updated_at) desc
      limit ${limit}
    `)) as unknown as any[];
    return rows.map((r) => ({
      orderId: String(r.order_id),
      orderStatus: String(r.order_status),
      taskStatus: r.task_status === null || r.task_status === undefined ? null : String(r.task_status),
      reservedRows: num(r.reserved_rows),
      consumedRows: num(r.consumed_rows),
    }));
  }

  async scanInventory(limit: number): Promise<InventoryRow[]> {
    const rows = (await db.execute(sql`
      select p.id as product_id,
             p.stock_quantity as stock_quantity,
             p.reserved_quantity as reserved_quantity,
             coalesce(sum(case when r.status = 'reserved' then r.reserved_quantity else 0 end), 0) as ledger_reserved_sum
      from products p
      left join inventory_reservations r on r.product_id = p.id
      group by p.id, p.stock_quantity, p.reserved_quantity
      limit ${limit}
    `)) as unknown as any[];
    return rows.map((r) => ({
      productId: String(r.product_id),
      stockQuantity: num(r.stock_quantity),
      reservedQuantity: num(r.reserved_quantity),
      ledgerReservedSum: num(r.ledger_reserved_sum),
    }));
  }
}
