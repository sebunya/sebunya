import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { INearbyDemandReader, NearbyScope } from '../../../application/ports/INearbyDemandReader';
import { pgInTextList } from '../PgParams';

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] })?.rows ?? []));

/**
 * Paid (or delivered) orders by delivery place. A buyer is the account, else the phone number's last nine digits
 * (+256 772…, 256772… and 0772… are one person), so one customer ordering twice counts once.
 */
export class DrizzleNearbyDemandReader implements INearbyDemandReader {
  async topProducts(scope: NearbyScope, input: { sinceDays: number; minBuyers: number; limit: number }): Promise<Array<{ productId: string; buyers: number }>> {
    const since = new Date(Date.now() - input.sinceDays * 86_400_000);
    const where =
      scope.kind === 'area'
        ? sql`o.delivery_location->>'areaSlug' = ${scope.areaSlug}`
        : scope.kind === 'district'
          ? sql`lower(o.delivery_location->>'district') = ${scope.district.toLowerCase()}`
          : pgInTextList(sql`lower(o.delivery_location->>'district')`, scope.districts.map((d) => d.toLowerCase()));
    const r = rows(await db.execute(sql`
      select oi.product_id, count(distinct coalesce(o.user_id::text, right(regexp_replace(coalesce(o.customer_phone, ''), '\\D', '', 'g'), 9))) as buyers
      from orders o join order_items oi on oi.order_id = o.id
      where o.created_at > ${since}
        and (o.payment_status = 'paid' or o.status in ('delivered', 'completed'))
        and o.order_number not like 'GP-DRAFT%'
        and ${where}
      group by oi.product_id
      having count(distinct coalesce(o.user_id::text, right(regexp_replace(coalesce(o.customer_phone, ''), '\\D', '', 'g'), 9))) >= ${input.minBuyers}
      order by buyers desc, oi.product_id
      limit ${input.limit}`));
    return r.map((x) => ({ productId: String(x.product_id), buyers: Number(x.buyers) }));
  }
}
