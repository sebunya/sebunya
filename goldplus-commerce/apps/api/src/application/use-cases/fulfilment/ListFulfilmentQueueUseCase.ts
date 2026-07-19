import {
  FulfilmentStatus,
  FULFILMENT_STATUSES,
  FulfilmentTaskSnapshot,
  isTerminalFulfilmentStatus,
} from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';

export interface ListFulfilmentQueueInput {
  status?: string | null;
  activeOnly?: boolean;
  assignedTo?: string | 'unassigned' | null;
  teamId?: string | 'unassigned' | null;
  limit?: number;
  offset?: number;
  /** Clock injection for deterministic overdue computation (defaults to now). */
  now?: Date;
}

/** A queue row plus the derived, non-persisted overdue flag. */
export type FulfilmentQueueRow = FulfilmentTaskSnapshot & { overdue: boolean };

export interface ListFulfilmentQueueResult {
  tasks: FulfilmentQueueRow[];
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
      assignedTo: input.assignedTo ?? null,
      teamId: input.teamId ?? null,
      limit,
      offset,
    });
    const now = input.now ?? new Date();
    const tasks: FulfilmentQueueRow[] = page.tasks.map((t) => ({
      ...t,
      overdue: !isTerminalFulfilmentStatus(t.status) && now.getTime() > new Date(t.slaDueAt).getTime(),
    }));
    return { tasks, total: page.total, limit, offset };
  }
}
