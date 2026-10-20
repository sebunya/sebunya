import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { DealerAccountView, IDealerPortalReader } from '../../application/ports/IDealerPortalReader';

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, any>>;
const iso = (v: unknown) => new Date(v as string).toISOString();

/**
 * A verified phone's own records. Phones are stored in several shapes (0772…, +256772…, 256772…), so every match
 * is on the last nine digits. Kampala months for the statement. Nothing about anyone else is read.
 */
export class DrizzleDealerPortalReader implements IDealerPortalReader {
  async account(phone: string): Promise<DealerAccountView> {
    const nine = phone.replace(/\D/g, '').slice(-9);
    const same = (col: string) => sql.raw(`right(regexp_replace(${col}, '\\D', '', 'g'), 9)`);

    const [app, quotes, lines, orders, statement] = await Promise.all([
      db.execute(sql`select business_name, status, created_at from dealer_applications where ${same('phone')} = ${nine} order by created_at desc limit 1`),
      db.execute(sql`select id, reference, status, created_at, estimated_total_ugx from quote_requests where ${same('phone')} = ${nine} order by created_at desc limit 20`),
      db.execute(sql`select l.quote_request_id, l.product_name, l.quantity, l.unit_kind, l.unit_count, l.unit_price_ugx, l.line_total_ugx
                       from quote_request_lines l join quote_requests q on q.id = l.quote_request_id
                      where ${same('q.phone')} = ${nine} order by l.quote_request_id, l.line_no`),
      db.execute(sql`select o.order_number, o.created_at, o.status, o.payment_status, o.total_amount,
                            (select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id) as item_count
                       from orders o where ${same('o.customer_phone')} = ${nine} order by o.created_at desc limit 50`),
      db.execute(sql`select to_char(date_trunc('month', o.created_at at time zone 'Africa/Kampala'), 'YYYY-MM') as month,
                            count(*)::int as orders,
                            coalesce(sum(o.total_amount), 0)::bigint as total,
                            coalesce(sum(o.total_amount) filter (where o.payment_status = 'paid'), 0)::bigint as paid,
                            coalesce(sum(o.total_amount) filter (where o.payment_status <> 'paid' and o.status <> 'cancelled'), 0)::bigint as unpaid_open
                       from orders o where ${same('o.customer_phone')} = ${nine}
                      group by 1 order by 1 desc limit 12`),
    ]);

    const linesByQuote = new Map<string, DealerAccountView['quotes'][number]['lines']>();
    for (const l of rowsOf(lines)) {
      const list = linesByQuote.get(l.quote_request_id) ?? [];
      list.push({
        productName: l.product_name, quantity: l.quantity === null ? null : Number(l.quantity), unitKind: l.unit_kind,
        unitCount: l.unit_count === null ? null : Number(l.unit_count),
        unitPriceUgx: l.unit_price_ugx === null ? null : Number(l.unit_price_ugx), lineTotalUgx: l.line_total_ugx === null ? null : Number(l.line_total_ugx),
      });
      linesByQuote.set(l.quote_request_id, list);
    }
    const a = rowsOf(app)[0];
    return {
      application: a ? { businessName: a.business_name, status: a.status, submittedAt: iso(a.created_at) } : null,
      quotes: rowsOf(quotes).map((q) => ({
        reference: q.reference ?? null, status: q.status, submittedAt: iso(q.created_at),
        estimatedTotalUgx: q.estimated_total_ugx === null ? null : Number(q.estimated_total_ugx), lines: linesByQuote.get(q.id) ?? [],
      })),
      orders: rowsOf(orders).map((o) => ({ orderNumber: o.order_number, placedAt: iso(o.created_at), status: o.status, paymentStatus: o.payment_status, totalUgx: Number(o.total_amount), itemCount: Number(o.item_count) })),
      statement: rowsOf(statement).map((m) => ({ month: m.month, orders: Number(m.orders), totalUgx: Number(m.total), paidUgx: Number(m.paid), unpaidOpenUgx: Number(m.unpaid_open) })),
    };
  }
}
