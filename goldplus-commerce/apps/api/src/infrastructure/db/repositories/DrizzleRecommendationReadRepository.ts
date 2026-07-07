import { sql } from 'drizzle-orm';
import { db } from '../client';
import {
  IRecommendationReadRepository,
  CoOccurrenceResult,
  PopularProduct,
  RecentInteraction,
  RecommendationIdentity,
  RecommendationProductContext,
} from '../../../application/ports/IRecommendationReadRepository';
import { CandidateCoOccurrence, InteractionKind } from '../../../domain/recommendation/Recommendation';

type Row = Record<string, unknown>;

function rows(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && Array.isArray((result as any).rows)) return (result as any).rows as Row[];
  return [];
}
const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => String(v ?? '');

// Default time windows (days). Co-signals are windowed so stale behaviour
// doesn't dominate; tune per surface via opts.
const WINDOW = { coView: 60, coCart: 60, coPurchase: 180, trending: 14, bestseller: 90, newArrival: 45 };
const NEW_ARRIVAL_DAYS = 30;

// Event hygiene: activity_events currently has no bot/internal/environment
// flags. TODO (schema): add `is_internal boolean`, `source varchar`, and a
// bot heuristic column so staff/QA/bot traffic can be excluded here. Until
// then we require a non-null actor id (visitor or user) as a minimal filter.

export class DrizzleRecommendationReadRepository implements IRecommendationReadRepository {
  async getCoViewed(productId: string, limit: number, opts?: { sinceDays?: number }): Promise<CoOccurrenceResult> {
    return this.coOccurrenceFromEvents(productId, limit, 'PRODUCT_VIEW', opts?.sinceDays ?? WINDOW.coView);
  }

  async getCoCarted(productId: string, limit: number, opts?: { sinceDays?: number }): Promise<CoOccurrenceResult> {
    return this.coOccurrenceFromEvents(productId, limit, 'ADD_TO_CART', opts?.sinceDays ?? WINDOW.coCart);
  }

  private async coOccurrenceFromEvents(
    productId: string,
    limit: number,
    eventType: 'PRODUCT_VIEW' | 'ADD_TO_CART',
    sinceDays: number
  ): Promise<CoOccurrenceResult> {
    const anchorRes = rows(
      await db.execute(sql`
        SELECT COUNT(DISTINCT visitor_id)::int AS support
        FROM activity_events
        WHERE event_type = ${eventType} AND entity = 'product' AND entity_id = ${productId}
          AND visitor_id IS NOT NULL AND created_at >= now() - make_interval(days => ${sinceDays})
      `)
    );
    const anchorSupport = num(anchorRes[0]?.support);
    if (anchorSupport === 0) return { anchorSupport: 0, candidates: [] };

    const candRes = rows(
      await db.execute(sql`
        WITH anchor_actors AS (
          SELECT DISTINCT visitor_id FROM activity_events
          WHERE event_type = ${eventType} AND entity = 'product' AND entity_id = ${productId}
            AND visitor_id IS NOT NULL AND created_at >= now() - make_interval(days => ${sinceDays})
        ),
        co AS (
          SELECT ae.entity_id AS product_id, COUNT(DISTINCT ae.visitor_id)::int AS co_count
          FROM activity_events ae
          JOIN anchor_actors av ON av.visitor_id = ae.visitor_id
          WHERE ae.event_type = ${eventType} AND ae.entity = 'product' AND ae.entity_id <> ${productId}
            AND ae.created_at >= now() - make_interval(days => ${sinceDays})
          GROUP BY ae.entity_id ORDER BY co_count DESC LIMIT ${limit}
        ),
        support AS (
          SELECT entity_id AS product_id, COUNT(DISTINCT visitor_id)::int AS support
          FROM activity_events
          WHERE event_type = ${eventType} AND entity = 'product'
            AND created_at >= now() - make_interval(days => ${sinceDays})
          GROUP BY entity_id
        )
        SELECT co.product_id, co.co_count, COALESCE(s.support, co.co_count) AS candidate_support
        FROM co LEFT JOIN support s ON s.product_id = co.product_id
      `)
    );
    return { anchorSupport, candidates: candRes.map(toCandidate) };
  }

  async getCoPurchased(productId: string, limit: number, opts?: { sinceDays?: number }): Promise<CoOccurrenceResult> {
    const sinceDays = opts?.sinceDays ?? WINDOW.coPurchase;
    const anchorRes = rows(
      await db.execute(sql`
        SELECT COUNT(DISTINCT oi.order_id)::int AS support
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = ${productId} AND o.created_at >= now() - make_interval(days => ${sinceDays})
      `)
    );
    const anchorSupport = num(anchorRes[0]?.support);
    if (anchorSupport === 0) return { anchorSupport: 0, candidates: [] };

    const candRes = rows(
      await db.execute(sql`
        WITH anchor_orders AS (
          SELECT DISTINCT oi.order_id FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = ${productId} AND o.created_at >= now() - make_interval(days => ${sinceDays})
        ),
        co AS (
          SELECT oi.product_id::text AS product_id, COUNT(DISTINCT oi.order_id)::int AS co_count
          FROM order_items oi JOIN anchor_orders ao ON ao.order_id = oi.order_id
          WHERE oi.product_id::text <> ${productId}
          GROUP BY oi.product_id ORDER BY co_count DESC LIMIT ${limit}
        ),
        support AS (
          SELECT oi.product_id::text AS product_id, COUNT(DISTINCT oi.order_id)::int AS support
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.created_at >= now() - make_interval(days => ${sinceDays})
          GROUP BY oi.product_id
        )
        SELECT co.product_id, co.co_count, COALESCE(s.support, co.co_count) AS candidate_support
        FROM co LEFT JOIN support s ON s.product_id = co.product_id
      `)
    );
    return { anchorSupport, candidates: candRes.map(toCandidate) };
  }

  async getSimilarForAnchor(productId: string, limit: number): Promise<CoOccurrenceResult> {
    const [viewed, purchased] = await Promise.all([this.getCoViewed(productId, limit), this.getCoPurchased(productId, limit)]);
    const merged = new Map<string, CandidateCoOccurrence>();
    for (const c of viewed.candidates) merged.set(c.productId, { ...c });
    for (const c of purchased.candidates) {
      const existing = merged.get(c.productId);
      const weighted = c.coCount * 2;
      if (existing) {
        existing.coCount += weighted;
        existing.candidateSupport = Math.max(existing.candidateSupport, c.candidateSupport);
      } else {
        merged.set(c.productId, { productId: c.productId, coCount: weighted, candidateSupport: c.candidateSupport });
      }
    }
    return { anchorSupport: Math.max(viewed.anchorSupport, purchased.anchorSupport, 1), candidates: [...merged.values()] };
  }

  async getPopularProducts(opts: { sinceDays: number; limit: number; categoryId?: string }): Promise<PopularProduct[]> {
    return this.getTrendingProducts(opts);
  }

  async getTrendingProducts(opts: { sinceDays: number; limit: number; categoryId?: string }): Promise<PopularProduct[]> {
    const categoryFilter = opts.categoryId
      ? sql`JOIN products p ON p.id::text = ae.entity_id WHERE p.category_id = ${opts.categoryId} AND`
      : sql`WHERE`;
    const res = rows(
      await db.execute(sql`
        SELECT ae.entity_id AS product_id,
               SUM(CASE WHEN ae.event_type = 'ADD_TO_CART' THEN 3 ELSE 1 END)::int AS score
        FROM activity_events ae
        ${categoryFilter}
          ae.entity = 'product' AND ae.event_type IN ('PRODUCT_VIEW','ADD_TO_CART')
          AND ae.created_at >= now() - make_interval(days => ${opts.sinceDays})
        GROUP BY ae.entity_id ORDER BY score DESC LIMIT ${opts.limit}
      `)
    );
    return res.map((r) => ({ productId: str(r.product_id), score: num(r.score) }));
  }

  async getBestSellingProducts(opts: { sinceDays: number; limit: number; categoryId?: string }): Promise<PopularProduct[]> {
    const categoryFilter = opts.categoryId
      ? sql`JOIN products p ON p.id = oi.product_id WHERE p.category_id = ${opts.categoryId} AND`
      : sql`WHERE`;
    const res = rows(
      await db.execute(sql`
        SELECT oi.product_id::text AS product_id, SUM(oi.quantity)::int AS score
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        ${categoryFilter}
          o.payment_status = 'paid' AND o.created_at >= now() - make_interval(days => ${opts.sinceDays})
        GROUP BY oi.product_id ORDER BY score DESC LIMIT ${opts.limit}
      `)
    );
    return res.map((r) => ({ productId: str(r.product_id), score: num(r.score) }));
  }

  async getMostCartedProducts(opts: { sinceDays: number; limit: number; categoryId?: string }): Promise<PopularProduct[]> {
    const categoryFilter = opts.categoryId
      ? sql`JOIN products p ON p.id::text = ae.entity_id WHERE p.category_id = ${opts.categoryId} AND`
      : sql`WHERE`;
    const res = rows(
      await db.execute(sql`
        SELECT ae.entity_id AS product_id, COUNT(*)::int AS score
        FROM activity_events ae
        ${categoryFilter}
          ae.entity = 'product' AND ae.event_type = 'ADD_TO_CART'
          AND ae.created_at >= now() - make_interval(days => ${opts.sinceDays})
        GROUP BY ae.entity_id ORDER BY score DESC LIMIT ${opts.limit}
      `)
    );
    return res.map((r) => ({ productId: str(r.product_id), score: num(r.score) }));
  }

  async getNewArrivals(opts: { limit: number; categoryId?: string }): Promise<PopularProduct[]> {
    const categoryFilter = opts.categoryId ? sql`AND category_id = ${opts.categoryId}` : sql``;
    const res = rows(
      await db.execute(sql`
        SELECT id::text AS product_id,
               EXTRACT(EPOCH FROM (now() - created_at))::int AS age_seconds
        FROM products
        WHERE active = true AND approval_status = 'approved' ${categoryFilter}
        ORDER BY created_at DESC LIMIT ${opts.limit}
      `)
    );
    // Newer = higher score.
    return res.map((r, i) => ({ productId: str(r.product_id), score: res.length - i }));
  }

  async getRecentInteractions(identity: RecommendationIdentity, limit: number): Promise<RecentInteraction[]> {
    const userId = identity.userId ?? null;
    const visitorId = identity.visitorId ?? null;
    if (!userId && !visitorId) return [];

    const viewCart = rows(
      await db.execute(sql`
        SELECT DISTINCT ON (ae.entity_id)
          ae.entity_id AS product_id, ae.event_type,
          EXTRACT(EPOCH FROM (now() - ae.created_at)) / 86400.0 AS age_days,
          p.name AS product_name
        FROM activity_events ae
        LEFT JOIN products p ON p.id::text = ae.entity_id
        WHERE ae.entity = 'product' AND ae.event_type IN ('PRODUCT_VIEW','ADD_TO_CART')
          AND ((${userId}::uuid IS NOT NULL AND ae.user_id = ${userId}::uuid)
               OR (${visitorId}::text IS NOT NULL AND ae.visitor_id = ${visitorId}::text))
        ORDER BY ae.entity_id, ae.created_at DESC
        LIMIT 50
      `)
    );

    const purchases = userId
      ? rows(
          await db.execute(sql`
            SELECT DISTINCT ON (oi.product_id) oi.product_id::text AS product_id,
              oi.product_name,
              EXTRACT(EPOCH FROM (now() - o.created_at)) / 86400.0 AS age_days
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.user_id = ${userId}::uuid
            ORDER BY oi.product_id, o.created_at DESC
            LIMIT 50
          `)
        )
      : [];

    // Merge, strongest kind wins per product (purchase > cart > view).
    const rank: Record<InteractionKind, number> = { view: 0, cart: 1, purchase: 2 };
    const byProduct = new Map<string, RecentInteraction>();
    const consider = (it: RecentInteraction) => {
      const existing = byProduct.get(it.productId);
      if (!existing || rank[it.kind] > rank[existing.kind]) byProduct.set(it.productId, it);
    };
    for (const r of viewCart) {
      consider({
        productId: str(r.product_id),
        productName: r.product_name ? str(r.product_name) : null,
        kind: (str(r.event_type) === 'ADD_TO_CART' ? 'cart' : 'view') as InteractionKind,
        ageDays: num(r.age_days),
      });
    }
    for (const r of purchases) {
      consider({ productId: str(r.product_id), productName: r.product_name ? str(r.product_name) : null, kind: 'purchase', ageDays: num(r.age_days) });
    }

    return [...byProduct.values()].sort((a, b) => a.ageDays - b.ageDays).slice(0, limit);
  }

  async getPurchasedProductIds(identity: RecommendationIdentity): Promise<string[]> {
    if (!identity.userId) return [];
    const res = rows(
      await db.execute(sql`
        SELECT DISTINCT oi.product_id::text AS product_id
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.user_id = ${identity.userId}::uuid
      `)
    );
    return res.map((r) => str(r.product_id));
  }

  async getCartProductIds(identity: RecommendationIdentity): Promise<string[]> {
    const userId = identity.userId ?? null;
    const visitorId = identity.visitorId ?? null;
    if (!userId && !visitorId) return [];
    const res = rows(
      await db.execute(sql`
        SELECT DISTINCT ci.product_id::text AS product_id
        FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
        WHERE (${userId}::uuid IS NOT NULL AND c.user_id = ${userId}::uuid)
           OR (${visitorId}::text IS NOT NULL AND c.session_id = ${visitorId}::text)
      `)
    );
    return res.map((r) => str(r.product_id));
  }

  async getProductContext(productIds: string[]): Promise<RecommendationProductContext[]> {
    if (productIds.length === 0) return [];
    const res = rows(
      await db.execute(sql`
        SELECT id::text AS product_id, category_id::text AS category_id, category_name,
               price_ugx, compare_at_price_ugx, stock_status, stock_quantity,
               active, approval_status, created_at,
               (created_at >= now() - make_interval(days => ${NEW_ARRIVAL_DAYS})) AS is_new
        FROM products
        WHERE id::text = ANY(${productIds})
      `)
    );
    return res.map((r) => {
      const price = r.price_ugx == null ? null : num(r.price_ugx);
      const compareAt = r.compare_at_price_ugx == null ? null : num(r.compare_at_price_ugx);
      const rawStock = str(r.stock_status) || null;
      const stockQty = r.stock_quantity == null ? null : num(r.stock_quantity);
      const stockStatus =
        rawStock === 'out_of_stock' || rawStock === 'discontinued' || rawStock === 'low_stock' || rawStock === 'in_stock'
          ? (rawStock as RecommendationProductContext['stockStatus'])
          : stockQty != null
            ? stockQty > 0
              ? 'in_stock'
              : 'out_of_stock'
            : null;
      return {
        productId: str(r.product_id),
        categoryId: r.category_id ? str(r.category_id) : null,
        categoryName: r.category_name ? str(r.category_name) : null,
        price,
        stockStatus,
        stockQty,
        isNewArrival: r.is_new === true || r.is_new === 't',
        isClearance: compareAt != null && price != null && compareAt > price,
        isPublished: r.active === true && str(r.approval_status) === 'approved',
      };
    });
  }
}

function toCandidate(r: Row): CandidateCoOccurrence {
  return { productId: str(r.product_id), coCount: num(r.co_count), candidateSupport: num(r.candidate_support) };
}
