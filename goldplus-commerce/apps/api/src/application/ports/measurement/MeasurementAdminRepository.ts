export interface ConsentBreakdown {
  analyticsGranted: boolean | null;
  advertisingGranted: boolean | null;
  personalizationGranted: boolean | null;
}

export interface MeasurementAdminRepository {
  getConsentBreakdown(): Promise<ConsentBreakdown[]>;
  getPendingOutboxCount(): Promise<number>;
  enqueueTelemetryDispatch(payload: any, eventId: string): Promise<void>;
}
