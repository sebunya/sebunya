import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * Hero telemetry (0108). Captures per-slide impressions and clicks and reports
 * them by slide and segment, so the library can be pruned by evidence.
 *
 * A slide sitting below a fair-sample CTR is taking a quarter of the most
 * valuable space on the site; the report exists to catch that.
 */

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

const SEGMENTS = new Set(['new', 'returning', 'regular', 'unknown']);
const EVENT_TYPES = new Set(['IMPRESSION', 'CLICK']);

export interface HeroSlideReportRow {
  slideKey: string;
  impressions: number;
  clicks: number;
  ctr: number | null; // null when impressions below the sample floor — no noise
}

const MIN_IMPRESSIONS_FOR_CTR = 100;

export class HeroTelemetryService {
  async capture(input: {
    eventType: string;
    slideKey: string;
    position: number;
    segment: string;
    profileId: string | null;
  }): Promise<{ recorded: boolean }> {
    const eventType = String(input.eventType || '').toUpperCase();
    const slideKey = String(input.slideKey || '').trim();
    if (!EVENT_TYPES.has(eventType)) return { recorded: false };
    if (!/^[a-z][a-z0-9]{1,23}$/.test(slideKey)) return { recorded: false };
    const segment = SEGMENTS.has(input.segment) ? input.segment : 'unknown';
    const position = Number.isInteger(input.position) && input.position >= 0 && input.position <= 20 ? input.position : 0;

    await db.execute(sql`
      insert into hero_events (event_type, slide_key, position, segment, profile_id)
      values (${eventType}, ${slideKey}, ${position}, ${segment}, ${input.profileId}::uuid)
    `);
    return { recorded: true };
  }

  /** Per-slide impressions, clicks and CTR over the window, plus per-segment. */
  async report(windowDays: number): Promise<{
    windowDays: number;
    slides: HeroSlideReportRow[];
    bySegment: Array<{ slideKey: string; segment: string; impressions: number; clicks: number }>;
  }> {
    const days = Math.min(365, Math.max(1, windowDays));
    const slideRows = rowsOf(
      await db.execute(sql`
        select slide_key,
               count(*) filter (where event_type = 'IMPRESSION')::int as impressions,
               count(*) filter (where event_type = 'CLICK')::int as clicks
        from hero_events
        where created_at >= now() - make_interval(days => ${days})
        group by slide_key
        order by impressions desc
      `),
    );
    const segRows = rowsOf(
      await db.execute(sql`
        select slide_key, segment,
               count(*) filter (where event_type = 'IMPRESSION')::int as impressions,
               count(*) filter (where event_type = 'CLICK')::int as clicks
        from hero_events
        where created_at >= now() - make_interval(days => ${days})
        group by slide_key, segment
        order by slide_key, segment
      `),
    );
    return {
      windowDays: days,
      slides: slideRows.map((r) => {
        const impressions = Number(r.impressions);
        const clicks = Number(r.clicks);
        return {
          slideKey: String(r.slide_key),
          impressions,
          clicks,
          ctr: impressions >= MIN_IMPRESSIONS_FOR_CTR ? Math.round((clicks / impressions) * 10000) / 100 : null,
        };
      }),
      bySegment: segRows.map((r) => ({
        slideKey: String(r.slide_key), segment: String(r.segment),
        impressions: Number(r.impressions), clicks: Number(r.clicks),
      })),
    };
  }
}
