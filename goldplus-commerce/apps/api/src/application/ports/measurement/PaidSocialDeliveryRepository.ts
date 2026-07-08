export interface PaidSocialDeliveryRepository {
  recordDeliveryAttempt(destinationId: string, eventId: string, status: string, error?: string): Promise<void>;
  getDeliveryHealthSummary(): Promise<any>;
  listFailedDeliveries(limit: number): Promise<any[]>;
  retryDelivery(eventId: string): Promise<void>;
}
