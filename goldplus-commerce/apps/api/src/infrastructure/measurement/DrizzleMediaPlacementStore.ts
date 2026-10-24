import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const PLACEMENT_MEDIA = ['youtube', 'radio', 'tv', 'billboard', 'podcast', 'press'] as const;
export const PLACEMENT_TYPES = ['dedicated', 'integration', 'mention', 'short', 'live', 'spot', 'feature'] as const;
export type PlacementMedium = typeof PLACEMENT_MEDIA[number];
export const MEDIUM_LABELS: Record<PlacementMedium, string> = { youtube: 'YouTube channel', radio: 'Radio', tv: 'TV', billboard: 'Billboard', podcast: 'Podcast', press: 'Press' };
/** The model channel a placement's money sits on: YouTube is its own lever; the rest are offline media. */
export const placementChannel = (medium: string): 'youtube' | 'offline_media' => (medium === 'youtube' ? 'youtube' : 'offline_media');

export interface MediaPlacementRow {
  id: string; medium: PlacementMedium; outlet: string; outletUrl: string | null; title: string; placementType: string; videoId: string | null;
  publishDate: string; flightDays: number; costUgx: number; payee: string | null; promoCode: string | null; linkSlug: string; expectedViews: number | null;
  expectedOrders: number | null; audienceUgShare: number | null; note: string | null; createdAt: string; latestViews: number | null; latestLikes: number | null; latestComments: number | null; viewsDay: string | null; link: string;
  /** Scorecard: arrivals through the description link, and sales credited to this placement (link, code or the customer's answer naming it). */
  arrivals: number; orders: number; revenueUgx: number; costPerOrderUgx: number | null;
}
export interface MediaPlacementInput {
  medium: string; outlet: string; outletUrl: string | null; title: string; placementType: string; videoUrl: string | null; publishDate: string;
  flightDays: number | null; costUgx: number; payee: string | null; promoCode: string | null; expectedViews: number | null; expectedOrders: number | null; audienceUgShare: number | null; note: string | null; actorId: string;
}

/** The YouTube video id from any of its URL shapes, or a bare id. Null when it is not one. */
export function youtubeVideoId(input: string | null | undefined): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return /^[A-Za-z0-9_-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    }
  } catch { /* not a URL */ }
  return null;
}

/** The link to paste into the video description or the outlet's page: lands on the placement's channel and names it. */
export function placementLink(medium: string, slug: string): string {
  const src = medium === 'youtube' ? 'youtube' : medium;
  const med = medium === 'youtube' ? 'sponsorship' : 'placement';
  return `https://shopgoldplus.com/?utm_source=${src}&utm_medium=${med}&utm_campaign=${encodeURIComponent(slug)}`;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** media_placements (0206): slots bought from YouTube channels, radio, TV and the like. */
export class DrizzleMediaPlacementStore {
  async list(days = 400): Promise<MediaPlacementRow[]> {
    return rows(await db.execute(sql`select p.*, p.publish_date::text as publish_day,
        v.views as latest_views, v.likes as latest_likes, v.comments as latest_comments, v.day::text as views_day,
        (select count(distinct t.anonymous_id)::int from measurement.touchpoint t where t.channel in ('youtube', 'offline_media') and t.campaign = p.link_slug and t.traffic_class = 'customer') as arrivals,
        (select count(distinct c.order_id)::int from measurement.order_channel_credit c join orders o on o.id = c.order_id
          where c.model = 'last_click' and c.channel in ('youtube', 'offline_media') and c.detail in (p.link_slug, p.outlet || ': ' || p.title)
            and o.status not in ('cancelled', 'failed', 'delivery_failed') and (o.payment_method is distinct from 'pesapal' or o.payment_status = 'paid')) as orders,
        (select coalesce(sum(c.credited_ugx), 0)::bigint from measurement.order_channel_credit c join orders o on o.id = c.order_id
          where c.model = 'last_click' and c.channel in ('youtube', 'offline_media') and c.detail in (p.link_slug, p.outlet || ': ' || p.title)
            and o.status not in ('cancelled', 'failed', 'delivery_failed') and (o.payment_method is distinct from 'pesapal' or o.payment_status = 'paid')) as revenue
      from media_placements p
      left join lateral (select views, likes, comments, day from media_placement_views v where v.placement_id = p.id order by v.day desc limit 1) v on true
      where p.deleted_at is null and p.publish_date >= current_date - ${days}::int order by p.publish_date desc, p.created_at desc`))
      .map((r) => {
        const orders = Number(r.orders ?? 0), cost = Number(r.cost_ugx);
        return { id: String(r.id), medium: r.medium, outlet: String(r.outlet), outletUrl: r.outlet_url ?? null, title: String(r.title), placementType: String(r.placement_type), videoId: r.video_id ?? null,
          publishDate: String(r.publish_day), flightDays: Number(r.flight_days), costUgx: cost, payee: r.payee ?? null, promoCode: r.promo_code ?? null, linkSlug: String(r.link_slug),
          expectedViews: r.expected_views == null ? null : Number(r.expected_views), expectedOrders: r.expected_orders == null ? null : Number(r.expected_orders), audienceUgShare: r.audience_ug_share == null ? null : Number(r.audience_ug_share),
          note: r.note ?? null, createdAt: new Date(r.created_at).toISOString(),
          latestViews: r.latest_views == null ? null : Number(r.latest_views), latestLikes: r.latest_likes == null ? null : Number(r.latest_likes), latestComments: r.latest_comments == null ? null : Number(r.latest_comments), viewsDay: r.views_day ?? null,
          link: placementLink(String(r.medium), String(r.link_slug)),
          arrivals: Number(r.arrivals ?? 0), orders, revenueUgx: Number(r.revenue ?? 0), costPerOrderUgx: orders > 0 ? Math.round(cost / orders) : null };
      });
  }

  async add(i: MediaPlacementInput): Promise<{ ok: true; id: string; link: string } | { ok: false; message: string }> {
    if (!(PLACEMENT_MEDIA as readonly string[]).includes(i.medium)) return { ok: false, message: 'Choose where the placement ran.' };
    if (!(PLACEMENT_TYPES as readonly string[]).includes(i.placementType)) return { ok: false, message: 'Choose what kind of placement it was.' };
    const outlet = i.outlet.trim(), title = i.title.trim();
    if (!outlet || outlet.length > 120) return { ok: false, message: 'Name the channel, station or paper, in up to 120 characters.' };
    if (!title || title.length > 160) return { ok: false, message: 'Say what the placement was, in up to 160 characters.' };
    if (!DAY.test(i.publishDate)) return { ok: false, message: 'The publish date is YYYY-MM-DD.' };
    // A video's cost sits on its publish day (the view counts then shape the exposure); a radio or TV booking runs over its days.
    const flightDays = i.flightDays ?? (i.medium === 'youtube' ? 1 : 7);
    if (!Number.isInteger(flightDays) || flightDays < 1 || flightDays > 90) return { ok: false, message: 'Flight days is a whole number from 1 to 90.' };
    if (!Number.isInteger(i.costUgx) || i.costUgx <= 0 || i.costUgx > 2_000_000_000) return { ok: false, message: 'The cost is whole shillings above zero.' };
    const videoId = i.medium === 'youtube' ? youtubeVideoId(i.videoUrl) : null;
    if (i.medium === 'youtube' && i.videoUrl?.trim() && !videoId) return { ok: false, message: 'That is not a YouTube video link (youtube.com/watch?v=…, youtu.be/…, or /shorts/…).' };
    if (i.outletUrl && i.outletUrl.length > 300) return { ok: false, message: 'The outlet link is too long.' };
    if (i.expectedViews != null && (!Number.isInteger(i.expectedViews) || i.expectedViews < 0)) return { ok: false, message: 'Expected views is a whole number.' };
    if (i.expectedOrders != null && (!Number.isInteger(i.expectedOrders) || i.expectedOrders < 0)) return { ok: false, message: 'Expected orders is a whole number.' };
    if (i.audienceUgShare != null && !(i.audienceUgShare > 0 && i.audienceUgShare <= 1)) return { ok: false, message: 'Uganda share of the audience is a fraction above 0 and at most 1 (e.g. 0.6 for 60%).' };
    const base = `${slugify(outlet)}-${slugify(title)}`.replace(/^-+|-+$/g, '').slice(0, 50) || 'placement';
    const slug = `${base}-${randomBytes(2).toString('hex')}`;
    const r = rows(await db.execute(sql`insert into media_placements (medium, outlet, outlet_url, title, placement_type, video_id, publish_date, flight_days, cost_ugx, payee, promo_code, link_slug, expected_views, expected_orders, audience_ug_share, note, created_by)
      values (${i.medium}, ${outlet}, ${i.outletUrl?.trim() || null}, ${title}, ${i.placementType}, ${videoId}, ${i.publishDate}::date, ${flightDays}, ${i.costUgx}, ${i.payee?.trim().slice(0, 120) || null},
        ${i.promoCode?.trim().toUpperCase().slice(0, 40) || null}, ${slug}, ${i.expectedViews}, ${i.expectedOrders}, ${i.audienceUgShare}, ${i.note?.trim().slice(0, 300) || null}, ${i.actorId || null}::uuid) returning id`))[0];
    return { ok: true, id: String(r.id), link: placementLink(i.medium, slug) };
  }

  async end(id: string, actorId: string): Promise<{ ok: true; wasLive: boolean } | { ok: false; message: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: 'Unknown placement.' };
    const r = rows(await db.execute(sql`update media_placements set deleted_at = now(), deleted_by = ${actorId || null}::uuid where id = ${id}::uuid and deleted_at is null returning id`));
    return { ok: true, wasLive: r.length > 0 };
  }
}
