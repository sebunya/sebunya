import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { FeedInventoryVersionPort } from '../../../application/use-cases/seo-growth/MerchantFeedCache';

/**
 * One hash over the inventory columns the Merchant feed derives availability
 * from (plus whether the product is live at all). A few hundred products: one small aggregate, far cheaper than the feed.
 */
export class DrizzleFeedInventoryVersion implements FeedInventoryVersionPort {
  async current(): Promise<string> {
    const result: any = await db.execute(sql`
      select md5(coalesce(string_agg(
        id::text || ':' || stock_quantity || ':' || coalesce(reserved_quantity, 0) || ':' || coalesce(stock_status, '') || ':' || is_pre_order_enabled::text
          || ':' || active::text || ':' || approval_status,
        ',' order by id), '')) as v
      from products`);
    const rows = Array.isArray(result) ? result : result?.rows ?? [];
    return String(rows[0]?.v ?? '');
  }
}
