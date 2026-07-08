export interface IMeasurementQueuePort {
  enqueuePaidSocialEvent(destinationName: string, payload: any): Promise<void>;
}
