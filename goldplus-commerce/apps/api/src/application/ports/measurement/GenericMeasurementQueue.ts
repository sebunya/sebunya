export type MeasurementEventSource =
  | 'product_finder'
  | 'preference_centre'
  | 'payment_reconciliation'
  | 'storefront';

export interface MeasurementQueueEvent {
  eventId: string;
  eventName: string;
  source: MeasurementEventSource;
  occurredAt: string;
  anonymousId?: string;
  customerId?: string;
  sessionId?: string;
  productId?: string;
  payload: Record<string, unknown>;
  consentState?: Record<string, unknown>;
  dryRun?: boolean;
}

export interface IGenericMeasurementQueue {
  enqueueMeasurementEvent(
    event: MeasurementQueueEvent
  ): Promise<{
    queued: boolean;
    status: string;
    eventId: string;
  }>;
}
