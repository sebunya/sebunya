import { PaidSocialDeliveryRepository } from '../../application/ports/measurement/PaidSocialDeliveryRepository';

export class DrizzlePaidSocialDeliveryRepository implements PaidSocialDeliveryRepository {
  // In a real database this would write to a delivery_logs or dlq table
  // Since we are not creating new tables unless they exist, we mock this locally
  private logs: any[] = [];

  async recordDeliveryAttempt(destinationId: string, eventId: string, status: string, error?: string): Promise<void> {
    this.logs.push({ destinationId, eventId, status, error, timestamp: new Date() });
  }

  async getDeliveryHealthSummary(): Promise<any> {
    const total = this.logs.length;
    const failed = this.logs.filter(l => l.status === 'FAILED').length;
    return { total, failed, health: failed === 0 ? 'HEALTHY' : 'DEGRADED' };
  }

  async listFailedDeliveries(limit: number): Promise<any[]> {
    return this.logs.filter(l => l.status === 'FAILED').slice(0, limit);
  }

  async retryDelivery(eventId: string): Promise<void> {
    const log = this.logs.find(l => l.eventId === eventId);
    if (log) log.status = 'RETRYING';
  }
}
