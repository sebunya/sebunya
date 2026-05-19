import { expect, test, describe } from 'vitest';
import { ListOrderNotificationsUseCase } from '../../apps/api/src/application/use-cases/notifications/ListOrderNotificationsUseCase';
import { PersistedNotificationAttempt } from '../../apps/api/src/application/ports/INotificationAttemptRepository';
import { PersistedOutboxEvent } from '../../apps/api/src/application/ports/IOutboxRepository';

describe('ListOrderNotificationsUseCase', () => {
  test('should return combined, sorted timeline items for a given orderId', async () => {
    const attempts: PersistedNotificationAttempt[] = [
      {
        id: 'attempt-1',
        channel: 'email',
        recipient: 'john@example.com',
        template: 'ORDER_PAYMENT_SUCCESS',
        status: 'sent',
        providerCode: '200',
        providerMessage: 'Delivered successfully',
        relatedEntity: 'order',
        relatedEntityId: 'order-123',
        attemptedAt: new Date('2026-05-19T10:00:00.000Z'),
      },
    ];

    const outboxEvents: PersistedOutboxEvent[] = [
      {
        id: 'outbox-1',
        eventType: 'PAYMENT_SUCCESS',
        payload: { recipient: 'john@example.com' },
        attemptCount: 0,
        isProcessed: false,
        createdAt: new Date('2026-05-19T09:50:00.000Z'),
        nextAttemptAt: new Date('2026-05-19T09:50:00.000Z'),
        idempotencyKey: 'key-1',
        channel: 'email',
        template: 'ORDER_PAYMENT_SUCCESS',
        status: 'pending',
        relatedEntity: 'order',
        relatedEntityId: 'order-123',
        dryRunOnly: true,
        previewOnly: false,
        noSendGuarantee: false,
        suppressedReason: null,
      },
    ];

    const mockAttemptRepo = {
      save: async () => { throw new Error('Not implemented'); },
      findRecent: async () => { throw new Error('Not implemented'); },
      findByRelatedEntity: async (entity: string, entityId: string) => {
        expect(entity).toBe('order');
        expect(entityId).toBe('order-123');
        return attempts;
      },
    };

    const mockOutboxRepo = {
      claimDueBatch: async () => { throw new Error('Not implemented'); },
      markProcessed: async () => { throw new Error('Not implemented'); },
      recordFailure: async () => { throw new Error('Not implemented'); },
      findByRelatedEntity: async (entity: string, entityId: string) => {
        expect(entity).toBe('order');
        expect(entityId).toBe('order-123');
        return outboxEvents;
      },
    };

    const useCase = new ListOrderNotificationsUseCase(mockOutboxRepo, mockAttemptRepo);
    const result = await useCase.execute('order-123');

    expect(result).toHaveLength(2);
    // Chronologically sorted (oldest first, so outbox-1 at 09:50 is before attempt-1 at 10:00)
    expect(result[0].id).toBe('outbox-1');
    expect(result[0].type).toBe('outbox');
    expect(result[0].status).toBe('pending');
    expect(result[0].dryRunOnly).toBe(true);

    expect(result[1].id).toBe('attempt-1');
    expect(result[1].type).toBe('attempt');
    expect(result[1].status).toBe('sent');
  });

  test('should throw error when orderId is empty', async () => {
    const useCase = new ListOrderNotificationsUseCase({} as any, {} as any);
    await expect(useCase.execute('')).rejects.toThrow('ORDER_ID_REQUIRED');
  });
});
