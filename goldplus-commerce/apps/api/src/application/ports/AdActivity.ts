import type { ActivityCount, AdOutcome } from '../../domain/advertising/AdActivity';

/** One delivery, newest first, as stored. No visitor identity, no payload. */
export interface AdActivityRecord {
  at: string;
  event: string;
  path: 'browse' | 'order';
  outcome: AdOutcome;
  reason: string | null;
  attempts: number;
  value: number | null;
  currency: string | null;
}

/**
 * Read-only view of what was queued for, and what reached, one ad platform.
 * Counts only: no click id, contact detail or visitor id ever leaves this port.
 */
export interface AdActivityRepository {
  /** Today's date in the shop's time zone (YYYY-MM-DD), so day buckets and the window agree. */
  today(): Promise<string>;
  /** Browsing events and order purchases for the platform since the given day, counted per day, event, outcome and stored reason. */
  counts(platform: string, sinceDay: string): Promise<ActivityCount[]>;
  /** The latest deliveries for the platform, newest first. */
  recent(platform: string, sinceDay: string, limit: number): Promise<AdActivityRecord[]>;
  /** Customer landings that carried the platform's click parameter, per day. */
  arrivals(clickParam: string, sinceDay: string): Promise<Array<{ day: string; n: number }>>;
  /** Visitors whose click id is in the identity graph, touched since the given day. */
  recognised(column: 'twclid' | 'gclid' | 'ttclid' | 'fbc' | 'epik' | 'li_fat_id', sinceDay: string): Promise<number>;
}
