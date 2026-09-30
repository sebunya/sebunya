import { sql } from 'drizzle-orm';
import { db } from '../client';

/**
 * Row counts for the admin capability hub (Wave 2D): one honest snapshot, no
 * derived health. A table that is absent or unreadable is reported as -1
 * (unknown), never as zero.
 *
 * The queries are fixed text defined here. routes/admin/new-modules.ts used to
 * build them and run them itself through a dynamic import of the db client.
 */
const HUB_COUNTS = {
  products: 'select count(*)::int as n from products',
  productsMissingImages: "select count(*)::int as n from products where has_image = false or image_url is null or image_url = ''",
  orders: 'select count(*)::int as n from orders',
  mediaAssets: "select count(*)::int as n from media_assets where status = 'ACTIVE'",
  legalPublished: "select count(*)::int as n from legal_policy_versions where status = 'PUBLISHED'",
  legalDrafts: "select count(*)::int as n from legal_policy_versions where status in ('DRAFT','IN_REVIEW')",
  abandonmentOpen: "select count(*)::int as n from cart_abandonments where status = 'OPEN'",
  reviewsPending: "select count(*)::int as n from reviews where status = 'pending'",
  flashSales: 'select count(*)::int as n from flash_sales',
  redirects: 'select count(*)::int as n from redirects',
  devices: 'select count(*)::int as n from devices',
  campaignsRows: 'select count(*)::int as n from campaigns',
} as const;

export type CapabilityHubCounts = Record<keyof typeof HUB_COUNTS, number>;

export class DrizzleCapabilityHubReader {
  async counts(): Promise<CapabilityHubCounts> {
    const count = async (query: string): Promise<number> => {
      try {
        const result = await db.execute(sql.raw(query));
        const rows = (Array.isArray(result) ? result : (result as unknown as { rows?: unknown[] }).rows ?? []) as Array<{ n?: unknown }>;
        return Number(rows[0]?.n ?? 0);
      } catch {
        return -1;
      }
    };
    const keys = Object.keys(HUB_COUNTS) as Array<keyof typeof HUB_COUNTS>;
    const values = await Promise.all(keys.map((k) => count(HUB_COUNTS[k])));
    return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as CapabilityHubCounts;
  }
}
