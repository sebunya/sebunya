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

export interface MatchQualitySummary {
  avgScore: number;
  below40Pct: number;
  above80Pct: number;
  totalEvents: number;
}

export interface AttributionRepository {
  getTouchpointsByOrderId(orderId: string): Promise<AttributionTouchpointRow[]>;
  getMatchQualitySummary(days: number): Promise<MatchQualitySummary>;
}
