import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
/** Views keep arriving long after a video goes out; readings stop after this many days from publish. */
export const VIEWS_FOLLOW_DAYS = 180;

export interface ViewsPullResult { configured: boolean; videos: number; written: number; missing: string[]; error?: string; skipped?: string }

/**
 * Nightly public view counts for the sponsored YouTube videos (0206): YouTube Data API v3 videos.list
 * (part=statistics) with an API key, which reads public statistics only and needs no sign-in. Written as the
 * cumulative count on the Kampala day of the reading; the dataset turns consecutive readings into the day's new
 * views. Without YOUTUBE_API_KEY nothing is called and the stats say so: never a guessed number.
 */
export class YouTubeViewsPull {
  constructor(private readonly apiKey: string | undefined, private readonly fetchImpl: typeof fetch = fetch) {}

  async run(now = new Date()): Promise<ViewsPullResult> {
    const key = (this.apiKey ?? '').trim();
    const placements = rows(await db.execute(sql`select id, video_id from media_placements where medium = 'youtube' and deleted_at is null and video_id is not null
      and publish_date >= current_date - ${VIEWS_FOLLOW_DAYS}::int and publish_date <= current_date`));
    if (!key) return { configured: false, videos: placements.length, written: 0, missing: [] };
    if (!placements.length) return { configured: true, videos: 0, written: 0, missing: [] };
    // A reading is a cumulative count at the moment it is taken. The nightly reads before 06:00 Kampala, when the count
    // is (almost) yesterday's total: it is filed under yesterday, so views sit on the day they happened, beside that
    // day's spend. A daytime run (an admin Rebuild) would file a partial day and shift the next one: it writes nothing.
    const kampalaHour = (now.getUTCHours() + 3) % 24;
    if (kampalaHour >= 6) return { configured: true, videos: placements.length, written: 0, missing: [], skipped: 'YouTube views are read by the night run only (before 6 am Kampala), and filed under the day before' };
    const day = new Date(now.getTime() + 3 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
    const byVideo = new Map<string, string[]>();
    for (const p of placements) { const ids = byVideo.get(String(p.video_id)) ?? []; ids.push(String(p.id)); byVideo.set(String(p.video_id), ids); }
    const ids = [...byVideo.keys()];
    let written = 0; const seen = new Set<string>();
    try {
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const url = `${VIDEOS_URL}?part=statistics&id=${batch.join(',')}&key=${encodeURIComponent(key)}`;
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`YouTube Data API answered HTTP ${res.status}`);
        const body = await res.json() as { items?: Array<{ id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }> };
        for (const item of body.items ?? []) {
          const views = Number(item.statistics?.viewCount);
          if (!Number.isFinite(views) || views < 0) continue;
          seen.add(item.id);
          const likes = Number.isFinite(Number(item.statistics?.likeCount)) ? Math.round(Number(item.statistics?.likeCount)) : null;
          const comments = Number.isFinite(Number(item.statistics?.commentCount)) ? Math.round(Number(item.statistics?.commentCount)) : null;
          for (const placementId of byVideo.get(item.id) ?? []) {
            await db.execute(sql`insert into media_placement_views (placement_id, day, views, likes, comments, fetched_at) values (${placementId}::uuid, ${day}::date, ${Math.round(views)}, ${likes}, ${comments}, ${now})
              on conflict (placement_id, day) do update set views = excluded.views, likes = excluded.likes, comments = excluded.comments, fetched_at = excluded.fetched_at`);
            written++;
          }
        }
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[youtube-views] pull failed');
      return { configured: true, videos: ids.length, written, missing: ids.filter((v) => !seen.has(v)), error: String((err as Error).message ?? err).slice(0, 200) };
    }
    // A video the API did not return is private, removed or mistyped: named, so the owner can fix the row.
    return { configured: true, videos: ids.length, written, missing: ids.filter((v) => !seen.has(v)) };
  }
}
