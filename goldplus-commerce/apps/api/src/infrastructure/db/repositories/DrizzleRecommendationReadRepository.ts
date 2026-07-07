import { sql } from 'drizzle-orm';
import { db } from '../client';
import {
  IRecommendationReadRepository,
  CoOccurrenceResult,
  PopularProduct,
  RecentInteraction,
  RecommendationIdentity,
} from '../../../application/ports/IRecommendationReadRepository';
import { CandidateCoOccurrence, InteractionKind } from '../../../domain/recommendation/Recommendation';

type Row = Record<string, unknown>;

function rows(result: unknown): Row[] {
  // postgres-js via drizzle returns an array-like of row objects.
  if (Array.isArray(result)) return result as Row[];
  if (result && Array.isArray((result as any).rows)) return (result as any).rows as Row[];
  return [];
}

const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => String(v ?? '');

export class DrizzleRecommendationReadRepository implements IRecommendationReadRepository {
  async getCoViewed(productId: string, limit: number): Promise<CoOccurrenceResult> {
    const anchorRes = rows(
      await db.execute(sql`
        SELECT COUNT(DISTINCT visitor_id)::int AS support
        FROM activity_events
        WHERE event_type = 'PRODUCT_VIEW' AND entity = 'product' AND entity_id = ${productId} AND visitor_id IS NOT NULL
      `)
    );
    const anchorSupport = num(anchorRes[0]?.support);
    if (anchorSupport === 0) return { anchorSupport: 0, candidates: [] };

    const candRes = rows(
      await db.execute(sql`
        WITH anchor_viewers AS (
          SELECT DISTINCT visitor_id FROM activity_events
          WHERE event_type = 'PRODUCT_VIEW' AND entity = 'product' AND entity_id = ${productId} AND visitor_id IS NOT NULL
        ),
        co AS (
          SELECT ae.entity_id AS product_id, COUNT(DISTINCT ae.visitor_id)::int AS co_count
          FROM activity_events ae
          JOIN anchor_viewers av ON av.visitor_id = ae.visitor_id
          WHERE ae.event_type = 'PRODUCT_VIEW' AND ae.entity = 'product' AND ae.entity_id <> ${productId}
          GROUP BY ae.entity_id
          ORDER BY co_count DESC
          LIMIT ${limit}
        ),
        support AS (
          SELECT entity_id AS product_id, COUNT(DISTINCT visitor_id)::int AS support
          FROM activity_events
          WHERE event_type = 'PRODUCT_VIEW' AND entity = 'product'
          GROUP BY entity_id
        )
        SELECT co.product_id, co.co_count, COALESCE(s.support, co.co_count) AS candidate_support
        FROM co LEFT JOIN support s ON s.product_id = co.product_id
      `)
    );
    return { anchorSupport, candidates: candRes.map(toCandidate) };
  }

  async getCoPurchased(productId: string, limit: number): Promise<CoOccurrenceResult> {
    const anchorRes = rows(
      await db.execute(sql`
        SELECT COUNT(DISTINCT order_id)::int AS support FROM order_items WHERE product_id = ${productId}
      `)
    );
    const anchorSupport = num(anchorRes[0]?.support);
    if (anchorSupport === 0) return { anchorSupport: 0, candidates: [] };

    const candRes = rows(
      await db.execute(sql`
        WITH anchor_orders AS (
          SELECT DISTINCT order_id FROM order_items WHERE product_id = ${productId}
        ),
        co AS (
          SELECT oi.product_id, COUNT(DISTINCT oi.order_id)::int AS co_count
          FROM order_items oi
          JOIN anchor_orders ao ON ao.order_id = oi.order_id
          WHERE oi.product_id <> ${productId}
          GROUP BY oi.product_id
          ORDER BY co_count DESC
          LIMIT ${limit}
        ),
        support AS (
          SELECT product_id, COUNT(DISTINCT order_id)::int AS support FROM order_items GROUP BY product_id
        )
        SELECT co.product_id, co.co_count, COALESCE(s.support, co.co_count) AS candidate_support
        FROM co LEFT JOIN support s ON s.product_id = co.product_id
      `)
    );
    return { anchorSupport, candidates: candRes.map(toCandidate) };
  }

  /** Union of co-view and co-purchase, purchase co-signal weighted higher. */
  async getSimilarForAnchor(productId: string, limit: number): Promise<CoOccurrenceResult> {
    const [viewed, purchased] = await Promise.all([
      this.getCoViewed(productId, limit),
      this.getCoPurchased(productId, limit),
    ]);

    const merged = new Map<string, CandidateCoOccurrence>();
    for (const c of viewed.candidates) merged.set(c.productId, { ...c });
    for (const c of purchased.candidates) {
      const existing = merged.get(c.productId);
      const weighted = c.coCount * 2; // a shared purchase is stronger than a shared view
      if (existing) {
        existing.coCount += weighted;
        existing.candidateSupport = Math.max(existing.candidateSupport, c.candidateSupport);
      } else {
        merged.set(c.productId, { productId: c.productId, coCount: weighted, candidateSupport: c.candidateSupport });
      }
    }
    return {
      anchorSupport: Math.max(viewed.anchorSupport, purchased.anchorSupport, 1),
      candidates: [...merged.values()],
    };
  }

  async getPopularProducts(opts: { sinceDays: number; limit: number; categoryId?: string }): Promise<PopularProduct[]> {
    const categoryFilter = opts.categoryId
      ? sql`JOIN products p ON p.id::text = ae.entity_id WHERE p.category_id = ${opts.categoryId} AND`
      : sql`WHERE`;

    const res = rows(
      await db.execute(sql`
        SELECT ae.entity_id AS product_id,
               SUM(CASE WHEN ae.event_type = 'ADD_TO_CART' THEN 3 ELSE 1 END)::int AS score
        FROM activity_events ae
        ${categoryFilter}
          ae.entity = 'product'
          AND ae.event_type IN ('PRODUCT_VIEW', 'ADD_TO_CART')
          AND ae.created_at >= now() - make_interval(days => ${opts.sinceDays})
        GROUP BY ae.entity_id
        ORDER BY score DESC
        LIMIT ${opts.limit}
      `)
    );
    return res.map((r) => ({ productId: str(r.product_id), score: num(r.score) }));
  }

  async getRecentInteractions(identity: RecommendationIdentity, limit: number): Promise<RecentInteraction[]> {
    const userId = identity.userId ?? null;
    const visitorId = identity.visitorId ?? null;
    if (!userId && !visitorId) return [];

    const res = rows(
      await db.execute(sql`
        SELECT DISTINCT ON (entity_id)
          entity_id AS product_id,
          event_type,
          EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 AS age_days
        FROM activity_events
        WHERE entity = 'product'
          AND event_type IN ('PRODUCT_VIEW', 'ADD_TO_CART')
          AND ((${userId}::uuid IS NOT NULL AND user_id = ${userId}::uuid)
               OR (${visitorId}::text IS NOT NULL AND visitor_id = ${visitorId}::text))
        ORDER BY entity_id, created_at DESC
        LIMIT ${limit}
      `)
    );

    return res.map((r) => ({
      productId: str(r.product_id),
      productName: null,
      kind: (str(r.event_type) === 'ADD_TO_CART' ? 'cart' : 'view') as InteractionKind,
      ageDays: num(r.age_days),
    }));
  }

  async getPurchasedProductIds(identity: RecommendationIdentity): Promise<string[]> {
    if (!identity.userId) return [];
    const res = rows(
      await db.execute(sql`
        SELECT DISTINCT oi.product_id::text AS product_id
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.user_id = ${identity.userId}::uuid
      `)
    );
    return res.map((r) => str(r.product_id));
  }
}

function toCandidate(r: Row): CandidateCoOccurrence {
  return {
    productId: str(r.product_id),
    coCount: num(r.co_count),
    candidateSupport: num(r.candidate_support),
  };
}
