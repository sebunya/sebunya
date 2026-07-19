import { FulfilmentDeliverySnapshot } from '../../domain/fulfilment/FulfilmentDelivery';

export interface FulfilmentDeliveryCreate {
  fulfilmentTaskId: string;
  orderId: string;
  attempt: number;
  outcome: FulfilmentDeliverySnapshot['outcome'];
  deliveredAt: Date | null;
  recipientNameMasked: string | null;
  recipientConfirmation: string | null;
  proofReference: string | null;
  failedReason: string | null;
  rescheduledFor: Date | null;
  deliveredQuantity: number;
  returnedQuantity: number;
  notes: string | null;
}

export interface IFulfilmentDeliveryRepository {
  listByTask(taskId: string): Promise<FulfilmentDeliverySnapshot[]>;
  countByTask(taskId: string): Promise<number>;
  /**
   * Append one delivery attempt. The unique (fulfilment_task_id, attempt) index
   * makes a duplicate attempt a no-op: created=false returns the existing row.
   */
  create(input: FulfilmentDeliveryCreate): Promise<{ created: boolean; delivery: FulfilmentDeliverySnapshot }>;
}
