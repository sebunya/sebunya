/**
 * The varchar widths of recommendation_events (schema/recommendations.ts).
 *
 * The browser sends document.referrer, the page path and raw utm_* values, and
 * nothing bounded them: one over-long value (a 151-character utm_campaign from
 * an ad, a long referrer carrying fbclid/gclid) made Postgres reject the whole
 * INSERT, and the event — often the ad-click landing view, the most valuable
 * one for attribution — was lost with a 500. Values are TRUNCATED to fit,
 * never rejected: the event matters more than the tail of a campaign name.
 */
export const RECOMMENDATION_EVENT_TEXT_WIDTHS = {
  anonymousId: 160,
  sessionId: 160,
  browserId: 160,
  source: 160,
  pagePath: 255,
  referrer: 500,
  utmSource: 100,
  utmMedium: 100,
  utmCampaign: 150,
  utmContent: 150,
  utmTerm: 150,
  deviceType: 50,
  browserFamily: 80,
  osFamily: 80,
  language: 30,
  timezone: 80,
  locationSource: 50,
  district: 120,
  town: 120,
  gpsGeohash: 16,
} as const;

export type RecommendationEventTextColumn = keyof typeof RECOMMENDATION_EVENT_TEXT_WIDTHS;

/** The value cut to its column's width; null/undefined pass through unchanged. */
export function fitColumn<T extends string | null | undefined>(column: RecommendationEventTextColumn, value: T): T {
  if (typeof value !== 'string') return value;
  const width = RECOMMENDATION_EVENT_TEXT_WIDTHS[column];
  return (value.length > width ? value.slice(0, width) : value) as T;
}
