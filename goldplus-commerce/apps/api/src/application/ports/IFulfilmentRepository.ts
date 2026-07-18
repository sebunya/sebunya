import { FulfilmentStatus, FulfilmentTask, FulfilmentTaskSnapshot } from '../../domain/fulfilment/FulfilmentTask';

export interface FulfilmentQueueQuery {
  status?: FulfilmentStatus | null;
  /** When true, only non-terminal (active) tasks are returned. */
  activeOnly?: boolean;
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
}
