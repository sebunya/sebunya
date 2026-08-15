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

  /**
   * Move ONE attempt from an expected status to the next one.
   *
   * Deliberately not `update(id, patch)`. An attempt is a state machine, and a
   * generic write lets a stale worker — one that slept through its lease, or a
   * duplicated queue job — overwrite a decision another worker already made.
   * Here the expected status is part of the WHERE clause, so a caller holding
   * an out-of-date view simply loses.
   *
   * Returns TRUE only when exactly one row moved. FALSE means "somebody else
   * got there first": re-read authoritative state, and above all do NOT carry
   * on as though the transition had happened. For the
   * PREPARED → DISPATCH_STARTED edge, carrying on regardless would put a
   * provider call on the far side of a boundary we never actually crossed,
   * which is the one thing the boundary exists to prevent.
   */
  transitionStatus(input: {
    attemptId: string;
    expectedStatus: NotificationStatus;
    nextStatus: NotificationStatus;
    providerCode?: string | null;
    providerMessage?: string | null;
  }): Promise<boolean>;
}
