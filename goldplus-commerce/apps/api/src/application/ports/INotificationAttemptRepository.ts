import { NotificationStatus } from './INotificationProvider';

export interface PersistedNotificationAttempt {
  id: string;
  channel: string;
  recipient: string;
  template: string;
  status: NotificationStatus;
  providerCode: string | null;
  providerMessage: string | null;
  relatedEntity: string | null;
  relatedEntityId: string | null;
  attemptedAt: Date;
}

export interface INotificationAttemptRepository {
  save(input: Omit<PersistedNotificationAttempt, 'id' | 'attemptedAt'>): Promise<PersistedNotificationAttempt>;
  findRecent(opts: { limit: number }): Promise<PersistedNotificationAttempt[]>;
  findByRelatedEntity(entity: string, entityId: string): Promise<PersistedNotificationAttempt[]>;
}
