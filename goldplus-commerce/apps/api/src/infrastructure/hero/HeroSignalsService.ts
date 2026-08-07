import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * Per-visitor hero signals (Task 3, 2026-08-07).
 *
 * These are the signals the client-side engine CANNOT see for itself — they
 * come from the server-issued experience profile and the catalogue. They are
 * ENHANCEMENTS: the hero renders four sensible slides with none of this, and
 * this endpoint is fetched AFTER the neutral SSR lead has already painted, so
 * it is never on the critical path and never varies an edge-cached response.
 *
 * Everything here is derived from the server profile (both sides server-issued)
 * and public catalogue facts. No PII is returned; the shapes are counts,
 * booleans, category slugs and stock flags.
 */

export interface HeroSignals {
  /**
   * Visit strength derived server-side from the profile: 1 = first session,
   * >=2 = returning, >=4 = regular. Replaces the old client-side localStorage
   * visit counter now that selection is server-authoritative.
   */
  visits: number;
  /** Has this customer ever placed a paid order? Suppresses first-order promos. */
  hasOrdered: boolean;
  /** Top browsed categories for this profile, strongest first. */
  categoryAffinity: Array<{ categorySlug: string; score: number }>;
  /** The best in-stock product to show in the arch for this visitor, or null. */
  preferredProduct: { imageUrl: string; alt: string; categorySlug: string } | null;
  /** Real loyalty state — only when the profile is a logged-in customer. */
  loyalty: { points: number; tierLabel: string; goalRemaining: number } | null;
  /** in-stock flag per product slug the slides reference, so E can gate. */
  stockBySlug: Record<string, boolean>;
  /**
   * Delivery zone is UNAVAILABLE before checkout: we do not know the visitor's
   * address, and guessing a zone's price is worse than saying nothing (§4.2 F).
   * The seam exists; the value is honestly null.
   */
  zone: null;
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

const EMPTY: HeroSignals = {
  visits: 1, hasOrdered: false, categoryAffinity: [], preferredProduct: null, loyalty: null, stockBySlug: {}, zone: null,
};

export class HeroSignalsService {
  /**
   * @param profileId server-issued experience-profile id, or null for a
   *   visitor with no resolvable profile (the endpoint still returns a safe,
   *   empty-ish payload — the engine treats absence as "no enhancement").
   * @param productSlugs the product slugs the slides reference, so stock is
   *   only looked up for what the hero can actually show.
   */
  async getSignals(profileId: string | null, productSlugs: string[]): Promise<HeroSignals> {
    if (!profileId) {
      // Even with no profile we can still report stock for the referenced SKUs.
      return { ...EMPTY, stockBySlug: await this.stockFor(productSlugs) };
    }

    try {
      const [affinity, ordered, loyalty, stock, visits] = await Promise.all([
        this.categoryAffinity(profileId),
        this.hasOrdered(profileId),
        this.loyaltyFor(profileId),
        this.stockFor(productSlugs),
        this.visitStrength(profileId),
      ]);

      const preferredProduct = affinity.length > 0 ? await this.preferredProduct(affinity[0].categorySlug) : null;

      return { visits, hasOrdered: ordered, categoryAffinity: affinity, preferredProduct, loyalty, stockBySlug: stock, zone: null };
    } catch {
      // A signals failure must never break the hero: return the neutral payload.
      return EMPTY;
    }
  }

  /**
   * How established this visitor is, as an integer that mirrors the old
   * client-side visit counter: 1 = first session, >=2 = returning, >=4 =
   * regular. Derived from the profile's tenure (first_seen_at) refined upward
   * by the number of distinct days it has generated events — whichever is
   * stronger. A brand-new profile seen minutes ago with no events scores 1.
   */
  private async visitStrength(profileId: string): Promise<number> {
    const rows = rowsOf(
      await db.execute(sql`
        select
          extract(epoch from (now() - ep.first_seen_at)) as age_seconds,
          coalesce((
            select count(distinct date_trunc('day', e.created_at))
            from recommendation_events e
            where e.profile_id = ${profileId}::uuid
              and e.created_at >= now() - interval '180 days'
          ), 0)::int as event_days
        from experience_profiles ep
        where ep.id = ${profileId}::uuid
        limit 1
      `),
    );
    if (!rows.length) return 1;
    const ageSeconds = Number(rows[0].age_seconds ?? 0);
    const eventDays = Number(rows[0].event_days ?? 0);
    // Tenure-based floor: seen >14d ago → regular-ish (4); >20h ago → returning (2).
    const tenure = ageSeconds > 14 * 86400 ? 4 : ageSeconds > 20 * 3600 ? 2 : 1;
    return Math.max(1, tenure, eventDays);
  }

  /** Categories this profile has engaged with, by weighted event count. */
  private async categoryAffinity(profileId: string): Promise<Array<{ categorySlug: string; score: number }>> {
    const rows = rowsOf(
      await db.execute(sql`
        select c.slug as category_slug,
               sum(case e.event_type
                     when 'RECOMMENDATION_ADD_TO_CART' then 3
                     when 'PRODUCT_ADDED_TO_CART' then 3
                     when 'RECOMMENDATION_CLICKED' then 2
                     when 'PRODUCT_VIEWED' then 1
                     else 0 end)::int as score
        from recommendation_events e
        join products p on p.id = coalesce(e.recommendation_product_id, e.product_id)
        join categories c on c.id = p.category_id
        where e.profile_id = ${profileId}::uuid
          and e.created_at >= now() - interval '90 days'
        group by c.slug
        having sum(case e.event_type
                     when 'RECOMMENDATION_ADD_TO_CART' then 3
                     when 'PRODUCT_ADDED_TO_CART' then 3
                     when 'RECOMMENDATION_CLICKED' then 2
                     when 'PRODUCT_VIEWED' then 1
                     else 0 end) > 0
        order by score desc
        limit 5
      `),
    );
    return rows.map((r) => ({ categorySlug: String(r.category_slug), score: Number(r.score) }));
  }

  private async hasOrdered(profileId: string): Promise<boolean> {
    const rows = rowsOf(
      await db.execute(sql`
        select 1
        from orders o
        where o.payment_status = 'paid' and o.status <> 'cancelled'
          and (o.profile_id = ${profileId}::uuid
               or o.user_id = (select customer_id from experience_profiles where id = ${profileId}::uuid))
        limit 1
      `),
    );
    return rows.length > 0;
  }

  private async loyaltyFor(profileId: string): Promise<HeroSignals['loyalty']> {
    // Balance is the signed sum of the ledger (earn +, redeem/expiry −), the
    // same derivation the loyalty repository uses. Only for a logged-in profile.
    const rows = rowsOf(
      await db.execute(sql`
        select coalesce(sum(le.points), 0)::int as points
        from experience_profiles ep
        join loyalty_accounts la on la.user_id = ep.customer_id
        left join loyalty_ledger_entries le on le.account_id = la.id
        where ep.id = ${profileId}::uuid and ep.customer_id is not null
        group by la.id
        limit 1
      `),
    );
    if (!rows.length) return null;
    const points = Number(rows[0].points ?? 0);
    // Tier thresholds are illustrative until the loyalty tier table is wired;
    // the meter shows the REAL balance, and the goal is derived from it.
    const nextGoal = points < 1000 ? 1000 : points < 2500 ? 2500 : points < 5000 ? 5000 : points + 1;
    const tierLabel = points >= 5000 ? 'Platinum' : points >= 2500 ? 'Gold' : points >= 1000 ? 'Silver' : 'Member';
    return { points, tierLabel, goalRemaining: Math.max(0, nextGoal - points) };
  }

  private async preferredProduct(categorySlug: string): Promise<HeroSignals['preferredProduct']> {
    const rows = rowsOf(
      await db.execute(sql`
        select p.slug, p.name, p.image_url as image_url
        from products p
        join categories c on c.id = p.category_id
        where c.slug = ${categorySlug} and p.active and p.approval_status = 'approved'
          and p.stock_status = 'in_stock'
          and p.image_url is not null and p.image_url <> ''
        order by p.stock_quantity desc
        limit 1
      `),
    );
    if (!rows.length) return null;
    return { imageUrl: String(rows[0].image_url), alt: String(rows[0].name), categorySlug };
  }

  private async stockFor(slugs: string[]): Promise<Record<string, boolean>> {
    const clean = [...new Set(slugs.filter(Boolean))];
    if (clean.length === 0) return {};
    const rows = rowsOf(
      await db.execute(sql`
        select slug, (active and stock_status = 'in_stock' and stock_quantity > 0) as in_stock
        from products
        where slug = any(${sql`ARRAY[${sql.join(clean.map((s) => sql`${s}`), sql`, `)}]::text[]`})
      `),
    );
    const out: Record<string, boolean> = {};
    for (const r of rows) out[String(r.slug)] = Boolean(r.in_stock);
    return out;
  }
}
