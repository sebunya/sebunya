export interface PreferenceMeasurementEvent {
  eventName: 'preference_centre_viewed' | 'preference_updated' | 'consent_granted' | 'consent_withdrawn' | 'communication_opt_in' | 'communication_opt_out';
  userId: string;
  payload: Record<string, any>;
  source: string;
}

export interface PreferenceMeasurementPublisher {
  publishPreferenceUpdate(event: PreferenceMeasurementEvent): Promise<void>;
}
