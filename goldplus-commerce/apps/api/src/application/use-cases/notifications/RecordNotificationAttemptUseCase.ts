import { INotificationAttemptRepository, PersistedNotificationAttempt } from '../../ports/INotificationAttemptRepository';
import { NotificationStatus } from '../../ports/INotificationProvider';

export interface RecordNotificationAttemptInput {
  channel: string;
  recipient: string;
  template: string;
  status: NotificationStatus;
  providerCode: string | null;
  providerMessage: string | null;
  relatedEntity: string | null;
  relatedEntityId: string | null;
}

export class RecordNotificationAttemptUseCase {
  constructor(private readonly repository: INotificationAttemptRepository) {}

  async execute(input: RecordNotificationAttemptInput): Promise<PersistedNotificationAttempt> {
    return this.repository.save({
      channel: input.channel,
      recipient: input.recipient,
      template: input.template,
      status: input.status,
      providerCode: input.providerCode,
      providerMessage: input.providerMessage,
      relatedEntity: input.relatedEntity,
      relatedEntityId: input.relatedEntityId,
    });
  }
}
