import { IOutboxRepository } from '../../ports/IOutboxRepository';
import { INotificationAttemptRepository } from '../../ports/INotificationAttemptRepository';

export interface TimelineItem {
  id: string;
  type: 'attempt' | 'outbox';
  channel: string;
  recipient: string;
  template: string;
  status: string;
  timestamp: Date;
  providerCode: string | null;
  providerMessage: string | null;
  idempotencyKey: string | null;
  dryRunOnly: boolean;
  previewOnly: boolean;
  noSendGuarantee: boolean;
  suppressedReason: string | null;
}

export class ListOrderNotificationsUseCase {
  constructor(
    private readonly outboxRepository: IOutboxRepository,
    private readonly attemptRepository: INotificationAttemptRepository
  ) {}

  async execute(orderId: string): Promise<TimelineItem[]> {
    if (!orderId) {
      throw new Error('ORDER_ID_REQUIRED');
    }

    const [attempts, outboxEvents] = await Promise.all([
      this.attemptRepository.findByRelatedEntity('order', orderId),
      this.outboxRepository.findByRelatedEntity('order', orderId),
    ]);

    const items: TimelineItem[] = [];

    // Map attempts
    for (const a of attempts) {
      items.push({
        id: a.id,
        type: 'attempt',
        channel: a.channel,
        recipient: a.recipient,
        template: a.template,
        status: a.status,
        timestamp: a.attemptedAt,
        providerCode: a.providerCode,
        providerMessage: a.providerMessage,
        idempotencyKey: null,
        dryRunOnly: (a.status as string) === 'dry_run',
        previewOnly: false,
        noSendGuarantee: false,
        suppressedReason: null,
      });
    }

    // Map outbox events
    for (const o of outboxEvents) {
      items.push({
        id: o.id,
        type: 'outbox',
        channel: o.channel || 'unknown',
        recipient: (o.payload.recipient as string) || (o.payload.email as string) || (o.payload.phone as string) || '',
        template: o.template || o.eventType || 'unknown',
        status: o.status,
        timestamp: o.createdAt,
        providerCode: null,
        providerMessage: null,
        idempotencyKey: o.idempotencyKey || null,
        dryRunOnly: o.dryRunOnly,
        previewOnly: o.previewOnly,
        noSendGuarantee: o.noSendGuarantee,
        suppressedReason: o.suppressedReason || null,
      });
    }

    // Sort chronologically (oldest first)
    return items.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
}
