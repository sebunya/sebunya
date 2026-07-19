import { FulfilmentDispatch, FulfilmentDispatchSnapshot } from '../../domain/fulfilment/FulfilmentDispatch';

export interface FulfilmentDispatchCreate {
  fulfilmentTaskId: string;
  orderId: string;
  dispatchReference: string;
  method: FulfilmentDispatchSnapshot['method'];
  carrierName: string | null;
  riderName: string | null;
  contactMasked: string | null;
  paymentPolicy: FulfilmentDispatchSnapshot['paymentPolicy'];
  trackingStatus: FulfilmentDispatchSnapshot['trackingStatus'];
  stockConsumed: boolean;
  dispatchTime: Date;
  estimatedDeliveryAt: Date | null;
  notes: string | null;
}

export interface IFulfilmentDispatchRepository {
  getByTask(taskId: string): Promise<FulfilmentDispatchSnapshot | null>;
  /**
   * Idempotently create the single dispatch for a task (unique fulfilment_task_id).
   * If one already exists, the existing row is returned and created=false — a
   * duplicate dispatch never creates a second record and never re-consumes stock.
   */
  create(input: FulfilmentDispatchCreate): Promise<{ created: boolean; dispatch: FulfilmentDispatchSnapshot }>;
  /** Optimistic tracking update: persists only if the stored version matches. */
  updateWithVersion(dispatch: FulfilmentDispatch, expectedVersion: number): Promise<{ updated: boolean }>;
}
