import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { campaigns, utmLinks } from '../schema/advertising';
import { cartAbandonments } from '../schema/abandonment';

/**
 * First reader/writer for the campaigns + utm_links tables (Wave 2F, no-send).
 * Audience preview is COUNT-ONLY and consent-honest: it reports how many open
 * abandonments exist and how many carry a signed-in identity; consent evaluation
 * attaches at the send wave and the preview says so rather than pretending.
 */
export class DrizzleCampaignRepository {
  async list() {
    const rows = await db.select().from(campaigns).orderBy(desc(campaigns.id));
    const links = await db
      .select({ campaignId: utmLinks.campaignId, count: sql<number>`count(*)::int` })
      .from(utmLinks)
      .groupBy(utmLinks.campaignId);
    const linkCount = new Map(links.map((l) => [l.campaignId, l.count]));
    return rows.map((r) => ({ ...r, utmLinkCount: linkCount.get(r.id) ?? 0 }));
  }

  async create(input: { name: string; objective: string; channel: string; targetUrl: string | null }) {
    const [row] = await db.insert(campaigns).values({ ...input, status: 'DRAFT' }).returning();
    return row;
  }

  async findById(id: string) {
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    return row ?? null;
  }

  async setStatus(id: string, status: string) {
    const [row] = await db.update(campaigns).set({ status }).where(eq(campaigns.id, id)).returning();
    return row ?? null;
  }

  async addUtmLink(campaignId: string, utm: { source: string; medium: string; campaignName: string; content?: string | null; term?: string | null }) {
    const shortUrl = `gp-${Math.abs(
      [...`${campaignId}${utm.source}${utm.medium}${utm.campaignName}${utm.content ?? ''}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7),
    ).toString(36)}`;
    const [row] = await db
      .insert(utmLinks)
      .values({ campaignId, source: utm.source, medium: utm.medium, campaignName: utm.campaignName, content: utm.content ?? null, term: utm.term ?? null, shortUrl })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  async listUtmLinks(campaignId: string) {
    return db.select().from(utmLinks).where(eq(utmLinks.campaignId, campaignId));
  }

  /** Count-only audience preview over the abandonment pipeline (Wave 2E-1 rows). */
  async abandonedCartAudiencePreview() {
    const [row] = await db
      .select({
        openAbandonments: sql<number>`count(*) filter (where status = 'OPEN')::int`,
        withKnownIdentity: sql<number>`count(*) filter (where status = 'OPEN' and owner_kind = 'USER')::int`,
        guestOnly: sql<number>`count(*) filter (where status = 'OPEN' and (owner_kind is null or owner_kind != 'USER'))::int`,
        totalValueUgx: sql<number>`coalesce(sum(subtotal_ugx) filter (where status = 'OPEN'), 0)::bigint`,
      })
      .from(cartAbandonments);
    return row ?? { openAbandonments: 0, withKnownIdentity: 0, guestOnly: 0, totalValueUgx: 0 };
  }
}
