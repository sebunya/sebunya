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
  /**
   * Orders still in a LIVE status whose fulfilment task is terminal, or which
   * have no task at all.
   *
   * Only OUT_FOR_DELIVERY mirrors a task back onto its order, so cancelling a
   * task leaves the order exactly where it was. That is the right default —
   * cancelling a customer's order is a bigger act than clearing a queue entry,
   * and must never happen as a side effect. But it means the two can drift, and
   * an order with no active task is one nobody will ever pick: invisible to the
   * queue, still open to the customer. Reported, never auto-corrected.
   */
  findOrdersWithoutActiveTask(limit: number): Promise<Array<{
    orderId: string; orderNumber: string | null; orderStatus: string; taskStatus: string | null;
  }>>;
}
