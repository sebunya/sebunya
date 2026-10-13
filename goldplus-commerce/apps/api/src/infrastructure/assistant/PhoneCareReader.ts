import { sql } from 'drizzle-orm';
import { db } from '../db/client';

const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : (r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;

/**
 * Goldie on WhatsApp: Meta has verified the sender's number, so it is the
 * customer's proof for THEIR orders (placed with that phone) and, when it is
 * the verified phone on an account, their points. Matched on the last nine
 * digits, because checkout stores the number as typed (0772..., +256772...).
 */
export class PhoneCareReader {
  private static last9(phone: string): string | null {
    const d = phone.replace(/\D/g, '');
    return d.length >= 9 ? d.slice(-9) : null;
  }

  async recentOrders(phone: string): Promise<Array<{ orderNumber: string; status: string; paymentStatus: string; totalUgx: number; createdAt: string; deliveryArea: string; items: number }>> {
    const n = PhoneCareReader.last9(phone);
    if (!n) return [];
    const rows = rowsOf(await db.execute(sql`
      select o.order_number, o.status, o.payment_status, o.total_amount, o.created_at, o.delivery_area,
             (select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id) as items
      from orders o
      where right(regexp_replace(o.customer_phone, '\\D', '', 'g'), 9) = ${n} and o.order_number not like 'GP-DRAFT%'
      order by o.created_at desc
      limit 3
    `));
    return rows.map((r) => ({ orderNumber: String(r.order_number), status: String(r.status), paymentStatus: String(r.payment_status), totalUgx: Number(r.total_amount ?? 0), createdAt: new Date(String(r.created_at)).toISOString(), deliveryArea: String(r.delivery_area ?? ''), items: Number(r.items ?? 0) }));
  }

  /** The account whose VERIFIED phone this is (an unverified phone on an account proves nothing). */
  async verifiedUserId(phone: string): Promise<string | null> {
    const n = PhoneCareReader.last9(phone);
    if (!n) return null;
    const rows = rowsOf(await db.execute(sql`
      select id from users where phone_verified_at is not null and is_active and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = ${n}
      order by phone_verified_at desc limit 2
    `));
    return rows.length === 1 ? String(rows[0]!.id) : null; // two accounts on one number: answer for neither
  }
}
