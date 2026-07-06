import { IDashboardReadRepository, CommerceSnapshot, SystemHealthSnapshot } from '../../ports/IDashboardReadRepository';
import { IActivityEventRepository, EngagementCountRow } from '../../ports/IActivityEventRepository';

export interface AdminDashboardDto {
  since: string;
  days: number;
  commerce: CommerceSnapshot;
  engagement: EngagementCountRow[];
  system: SystemHealthSnapshot;
}

const MAX_WINDOW_DAYS = 90;

export class GetAdminDashboardUseCase {
  constructor(
    private readonly dashboard: IDashboardReadRepository,
    private readonly events: IActivityEventRepository
  ) {}

  async execute(opts: { days?: number } = {}): Promise<AdminDashboardDto> {
    const days = Math.min(Math.max(1, Math.floor(opts.days ?? 7)), MAX_WINDOW_DAYS);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [commerce, system, engagement] = await Promise.all([
      this.dashboard.getCommerceSnapshot(since),
      this.dashboard.getSystemHealthSnapshot(since),
      this.events.countByTypeSince(since),
    ]);

    return { since: since.toISOString(), days, commerce, engagement, system };
  }
}
