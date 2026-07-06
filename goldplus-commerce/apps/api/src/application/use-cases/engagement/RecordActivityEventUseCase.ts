import { ActivityEventInput, validateActivityEvent } from '../../../domain/engagement/ActivityEvent';
import { IActivityEventRepository, PersistedActivityEvent } from '../../ports/IActivityEventRepository';

export type RecordActivityEventResult =
  | { ok: true; event: PersistedActivityEvent }
  | { ok: false; code: 'MISSING_VISITOR' | 'UNKNOWN_EVENT_TYPE' | 'BAD_PROPERTIES'; message: string };

export class RecordActivityEventUseCase {
  constructor(private readonly events: IActivityEventRepository) {}

  async execute(input: ActivityEventInput): Promise<RecordActivityEventResult> {
    const validation = validateActivityEvent(input);
    if (!validation.ok) {
      return { ok: false, code: validation.code, message: validation.message };
    }
    const event = await this.events.save(validation.event);
    return { ok: true, event };
  }
}
