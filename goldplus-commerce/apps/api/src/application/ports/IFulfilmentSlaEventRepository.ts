import { FulfilmentSlaStage } from '../../domain/fulfilment/FulfilmentTask';

export interface FulfilmentSlaEventInput {
  taskId: string;
  stage: FulfilmentSlaStage;
  policyVersion: number;
  idempotencyKey: string;
  teamId: string | null;
  assigneeId: string | null;
  dueAtSnapshot: Date;
  prioritySnapshot: string;
  detail?: string | null;
}

export interface IFulfilmentSlaEventRepository {
  /**
   * Insert an SLA event only if the idempotency key is new. Returns created=false
   * when the (task, stage, policy version) event already exists — repeated
   * scheduler ticks and concurrent workers never duplicate escalation.
   */
  insertIfNew(input: FulfilmentSlaEventInput): Promise<{ created: boolean }>;
  /** Counts of currently-relevant SLA events by stage, for the admin badge. */
  countByStage(): Promise<Record<string, number>>;
  latestForTask(taskId: string): Promise<{ stage: string; occurredAt: Date } | null>;
}
