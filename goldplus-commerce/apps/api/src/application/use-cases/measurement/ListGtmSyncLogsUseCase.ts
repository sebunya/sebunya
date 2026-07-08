import { GtmPlanRepository } from '../../ports/measurement/GtmPlanRepository';

export class ListGtmSyncLogsUseCase {
  constructor(private readonly planRepo: GtmPlanRepository) {}

  async execute(limit: number = 50) {
    const logs = await this.planRepo.listSyncLogs(limit);
    return { status: 'OK', data: logs };
  }
}
