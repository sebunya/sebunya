import { FulfilmentStatus, FULFILMENT_STATUSES, FulfilmentTaskSnapshot } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';

export interface ListFulfilmentQueueInput {
  status?: string | null;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListFulfilmentQueueResult {
  tasks: FulfilmentTaskSnapshot[];
  total: number;
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Read-only admin "New Orders" / fulfilment queue, newest-actionable first. */
export class ListFulfilmentQueueUseCase {
  constructor(private readonly repo: IFulfilmentRepository) {}

  async execute(input: ListFulfilmentQueueInput = {}): Promise<ListFulfilmentQueueResult> {
    const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const offset = Math.max(0, input.offset ?? 0);
    let status: FulfilmentStatus | null = null;
    if (input.status) {
      if (!FULFILMENT_STATUSES.includes(input.status as FulfilmentStatus)) {
        throw new Error(`INVALID_STATUS: unknown fulfilment status "${input.status}"`);
      }
      status = input.status as FulfilmentStatus;
    }
    const page = await this.repo.listQueue({
      status,
      activeOnly: input.activeOnly ?? false,
      limit,
      offset,
    });
    return { tasks: page.tasks, total: page.total, limit, offset };
  }
}
