import { eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { orderAttribution } from '../schema/orderAttribution';

const clean = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const t = String(v).trim().slice(0, max);
  return t || null;
};

const CLICK_KEYS = new Set(['gclid', 'wbraid', 'gbraid', 'ttclid', 'twclid', 'li_fat_id', 'epik', 'msclkid', 'ScCid', 'clickid', 'click_id']);
/** Only known click-id keys, short printable values; null when none. */
function cleanClickIds(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (CLICK_KEYS.has(k) && typeof val === 'string' && /^[\x21-\x7e]{1,512}$/.test(val)) out[k] = val;
  }
  return Object.keys(out).length ? out : null;
}

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
  fpClientId?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  gaSessionId?: string | null;
  gaSessionNumber?: number | null;
  clickIds?: Record<string, string> | null;
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
        fpClientId: clean(input.fpClientId, 255),
        clientIp: clean(input.clientIp, 64),
        userAgent: clean(input.userAgent, 1024),
        gaSessionId: input.gaSessionId && /^\d{1,20}$/.test(input.gaSessionId) ? input.gaSessionId : null,
        gaSessionNumber: Number.isInteger(input.gaSessionNumber) && (input.gaSessionNumber as number) > 0 ? input.gaSessionNumber : null,
        clickIds: cleanClickIds(input.clickIds),
      })
      .onConflictDoNothing();
  }

  async getByOrderId(orderId: string) {
    const rows = await db.select().from(orderAttribution).where(eq(orderAttribution.orderId, orderId)).limit(1);
    return rows[0] ?? null;
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
