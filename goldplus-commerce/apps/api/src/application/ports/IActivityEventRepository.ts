import { ValidatedActivityEvent } from '../../domain/engagement/ActivityEvent';

export interface PersistedActivityEvent extends ValidatedActivityEvent {
  id: string;
  createdAt: Date;
}

export interface EngagementCountRow {
  eventType: string;
  count: number;
}

export interface IActivityEventRepository {
  save(event: ValidatedActivityEvent): Promise<PersistedActivityEvent>;
  countByTypeSince(since: Date): Promise<EngagementCountRow[]>;
  findRecentByVisitor(visitorId: string, limit: number): Promise<PersistedActivityEvent[]>;
}
