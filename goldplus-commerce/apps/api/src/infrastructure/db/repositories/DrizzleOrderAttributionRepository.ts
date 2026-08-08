import { eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { orderAttribution } from '../schema/orderAttribution';

const clean = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const t = String(v).trim().slice(0, max);
  return t || null;
};

export interface OrderAttributionInput {
  orderId: string;
  orderNumber?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  term?: string | null;
  content?: string | null;
  landingPath?: string | null;
  referrer?: string | null;
  firstAt?: string | Date | null;
}

/**
 * Order attribution (0111). Write-once per order (best-effort); read for the
 * admin report. Never throws in a way that could affect an order.
 */
export class DrizzleOrderAttributionRepository {
  async record(input: OrderAttributionInput): Promise<void> {
    const first = input.firstAt ? new Date(input.firstAt) : null;
    await db
      .insert(orderAttribution)
      .values({
        orderId: input.orderId,
        orderNumber: clean(input.orderNumber, 20),
        source: clean(input.source, 120),
        medium: clean(input.medium, 120),
        campaign: clean(input.campaign, 160),
        term: clean(input.term, 160),
        content: clean(input.content, 160),
        landingPath: clean(input.landingPath, 2000),
        referrer: clean(input.referrer, 2000),
        firstAt: first && !Number.isNaN(first.getTime()) ? first : null,
      })
      .onConflictDoNothing();
  }

  async getByOrderNumber(orderNumber: string) {
    const rows = await db.select().from(orderAttribution).where(eq(orderAttribution.orderNumber, orderNumber)).limit(1);
    return rows[0] ?? null;
  }

  /** Orders grouped by channel over a window. (direct)/(none) label the unattributed. */
  async summary(windowDays: number) {
    const days = Math.min(365, Math.max(1, Number.isFinite(windowDays) ? windowDays : 30));
    const res = await db.execute(sql`
      select coalesce(nullif(source,''),'(direct)') as source,
             coalesce(nullif(medium,''),'(none)')   as medium,
             coalesce(nullif(campaign,''),'(none)') as campaign,
             count(*)::int as orders
      from order_attribution
      where created_at >= now() - make_interval(days => ${days})
      group by 1, 2, 3
      order by orders desc
      limit 100`);
    const rows = Array.isArray(res) ? res : (res as any).rows ?? [];
    return rows.map((r: any) => ({ source: String(r.source), medium: String(r.medium), campaign: String(r.campaign), orders: Number(r.orders) }));
  }
}
