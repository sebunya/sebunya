import { IActivityEventRepository, EngagementCountRow } from '../../ports/IActivityEventRepository';

export interface EngagementSummary {
  since: string;
  days: number;
  counts: EngagementCountRow[];
}

const MAX_WINDOW_DAYS = 90;

export class GetEngagementSummaryUseCase {
  constructor(private readonly events: IActivityEventRepository) {}

  async execute(opts: { days?: number } = {}): Promise<EngagementSummary> {
    const days = Math.min(Math.max(1, Math.floor(opts.days ?? 7)), MAX_WINDOW_DAYS);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const counts = await this.events.countByTypeSince(since);
    return { since: since.toISOString(), days, counts };
  }
}
