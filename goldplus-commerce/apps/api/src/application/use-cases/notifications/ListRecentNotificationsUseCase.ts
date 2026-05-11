import { INotificationAttemptRepository, PersistedNotificationAttempt } from '../../ports/INotificationAttemptRepository';

export interface ListRecentNotificationsInput {
  limit?: number;
}

export class ListRecentNotificationsUseCase {
  constructor(private readonly repository: INotificationAttemptRepository) {}

  async execute(input: ListRecentNotificationsInput = {}): Promise<PersistedNotificationAttempt[]> {
    const limit = input.limit || 50;
    return this.repository.findRecent({ limit });
  }
}
