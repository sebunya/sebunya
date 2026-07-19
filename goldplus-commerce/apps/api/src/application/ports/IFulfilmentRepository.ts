import { FulfilmentStatus, FulfilmentTask, FulfilmentTaskSnapshot } from '../../domain/fulfilment/FulfilmentTask';

export interface FulfilmentQueueQuery {
  status?: FulfilmentStatus | null;
  /** When true, only non-terminal (active) tasks are returned. */
  activeOnly?: boolean;
  /** Filter to a specific assignee, or the literal 'unassigned'. */
  assignedTo?: string | 'unassigned' | null;
  /** Filter to a specific team queue, or the literal 'unassigned' (no team). */
  teamId?: string | 'unassigned' | null;
  limit: number;
  offset: number;
}

export interface FulfilmentQueuePage {
  tasks: FulfilmentTaskSnapshot[];
  total: number;
}

export interface IFulfilmentRepository {
  /**
   * Idempotently create the task for an order. If a task already exists for the
   * orderId (unique constraint), the existing task is returned and created=false.
   */
  createForOrder(task: FulfilmentTask): Promise<{ created: boolean; task: FulfilmentTaskSnapshot }>;
  findByOrderId(orderId: string): Promise<FulfilmentTaskSnapshot | null>;
  findById(id: string): Promise<FulfilmentTaskSnapshot | null>;
  /** Persist an already-mutated task (transition / payment mirror / cancel). */
  update(task: FulfilmentTask): Promise<void>;
  listQueue(query: FulfilmentQueueQuery): Promise<FulfilmentQueuePage>;
  /** Badge count: number of unacknowledged NEW tasks. */
  countNew(): Promise<number>;
  /** Count of active (non-terminal) tasks past their SLA deadline. */
  countOverdue(now: Date): Promise<number>;
  /** Active (non-terminal) tasks for SLA evaluation, oldest-due first. */
  findActiveForSla(limit: number): Promise<FulfilmentTaskSnapshot[]>;
}
