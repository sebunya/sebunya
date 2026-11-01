export interface AttributionTouchpointRow {
  id: string;
  eventName: string;
  eventTime: Date;
  matchScore: number;
  routedDestinations: string[] | null;
  blockedDestinations: string[] | null;
  hasHashedEmail: number;
  hasHashedPhone: number;
  hasFbp: number;
  hasFbc: number;
  hasGclid: number;
  hasTtclid: number;
  hasIpAddress: number;
}

/**
 * Match quality over a window. With no conversion events there is no score:
 * the three rates are NULL ("no data"), never 0%, which read as a measured
 * total failure.
 */
/** Signals whose presence is recorded per touchpoint (has_* columns). */
export const MATCH_SIGNALS = ['hashedEmail', 'hashedPhone', 'fbp', 'fbc', 'gclid', 'ttclid', 'ipAddress'] as const;
export type MatchSignal = typeof MATCH_SIGNALS[number];

export interface MatchQualitySummary {
  avgScore: number | null;
  below40Pct: number | null;
  above80Pct: number | null;
  /** Raw counts behind the shares above; 0 when there are no events. */
  below40Count: number;
  above80Count: number;
  totalEvents: number;
  /** % of touchpoints in the window carrying each signal; null when there are no events (no data, never 0%). */
  signalCoverage: Record<MatchSignal, number | null>;
}

export interface AttributionRepository {
  getTouchpointsByOrderId(orderId: string): Promise<AttributionTouchpointRow[]>;
  getMatchQualitySummary(days: number): Promise<MatchQualitySummary>;
}
