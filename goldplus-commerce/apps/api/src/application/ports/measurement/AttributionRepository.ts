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
export interface MatchQualitySummary {
  avgScore: number | null;
  below40Pct: number | null;
  above80Pct: number | null;
  totalEvents: number;
}

export interface AttributionRepository {
  getTouchpointsByOrderId(orderId: string): Promise<AttributionTouchpointRow[]>;
  getMatchQualitySummary(days: number): Promise<MatchQualitySummary>;
}
