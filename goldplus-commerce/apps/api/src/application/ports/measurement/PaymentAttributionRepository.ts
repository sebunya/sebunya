export interface AttributionTouchpoint {
  id: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  timestamp: Date;
}

export interface AttributionSummary {
  orderId: string;
  paymentReference: string | null;
  touchpoints: AttributionTouchpoint[];
  isAttributed: boolean;
}

export interface IPaymentAttributionRepository {
  linkPaymentToTouchpoints(orderId: string, paymentReference: string | null): Promise<void>;
  findTouchpointsForOrder(orderId: string): Promise<AttributionTouchpoint[]>;
  findTouchpointsForIdentity(identityHash: string): Promise<AttributionTouchpoint[]>;
  getAttributionSummaryForPayment(orderId: string, paymentReference: string | null): Promise<AttributionSummary>;
}
