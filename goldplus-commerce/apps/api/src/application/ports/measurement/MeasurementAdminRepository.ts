export interface ConsentBreakdown {
  analyticsGranted: boolean | null;
  advertisingGranted: boolean | null;
  personalizationGranted: boolean | null;
}

export interface MeasurementAdminRepository {
  getConsentBreakdown(): Promise<ConsentBreakdown[]>;
  getPendingOutboxCount(): Promise<number>;
  /**
   * Idempotent on `replayKey` (the DLQ entry id): a double-clicked or
   * concurrent replay enqueues ONE dispatch. Falls back to the event id.
   */
  enqueueTelemetryDispatch(payload: any, eventId: string, replayKey?: string): Promise<void>;
}
