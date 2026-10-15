import {
  FulfilmentDeliverySnapshot,
  FulfilmentDeliveryOutcome,
  canRecordDelivery,
  validateDelivery,
  deliveryCompletesTask,
  maskRecipientName,
} from '../../../domain/fulfilment/FulfilmentDelivery';
import { FulfilmentTask } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IFulfilmentDeliveryRepository } from '../../ports/IFulfilmentDeliveryRepository';
import { IFulfilmentReportRepository, FulfilmentReport } from '../../ports/IFulfilmentReportRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { IOrderTransitionPort } from '../../ports/IOrderTransitionPort';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { mirrorOrderDispatched } from './DispatchUseCases';

/** What the quote capture needs to know about a recorded delivery attempt (0189). */
export interface IDeliveryCaptureMirror {
  recordAttempt(input: {
    orderId: string;
    taskId: string;
    attempt: number;
    completed: boolean;
    failedFirstAttempt: boolean;
    deliveredAt: Date | null;
  }): Promise<void>;
}

export type DeliveryError =
  | 'NOT_FOUND'
  | 'TASK_ON_HOLD'
  | 'TASK_NOT_OUT_FOR_DELIVERY'
  | 'INVALID_QUANTITY'
  | 'RESCHEDULE_DATE_REQUIRED'
  | 'FAILURE_REASON_REQUIRED';

type Fail = { ok: false; code: DeliveryError; message: string };
const fail = (code: DeliveryError, message: string): Fail => ({ ok: false, code, message });

export class GetDeliveryHistoryUseCase {
  constructor(
    private readonly tasks: IFulfilmentRepository,
    private readonly deliveries: IFulfilmentDeliveryRepository
  ) {}
  async execute(taskId: string): Promise<{ ok: true; status: string; deliveries: FulfilmentDeliverySnapshot[] } | Fail> {
    const task = await this.tasks.findById(taskId);
    if (!task) return fail('NOT_FOUND', 'Fulfilment task not found.');
    const deliveries = await this.deliveries.listByTask(taskId);
    return { ok: true, status: task.status, deliveries };
  }
}

/**
 * Record one delivery attempt. Only a dispatched (OUT_FOR_DELIVERY) task may take
 * an attempt; a DELIVERED outcome completes the task, every other outcome leaves
 * it dispatched for a further attempt. Recording a delivery NEVER changes payment.
 */
export class RecordDeliveryUseCase {
  constructor(
    private readonly tasks: IFulfilmentRepository,
    private readonly deliveries: IFulfilmentDeliveryRepository,
    private readonly audit: IAuditRepository,
    /**
     * Location module stage 2: a recorded outcome now also moves the ORDER
     * lifecycle (dispatched → delivered / delivery_failed) through the one
     * canonical ledgered path, so failed-delivery metrics are derivable from
     * order history. Optional so existing tests and callers stay valid; when
     * absent, only the fulfilment task moves (pre-stage-2 behaviour).
     */
    private readonly orderTransitions?: IOrderTransitionPort,
    /**
     * 0189: the delivery quote capture learns from this outcome (delivered_at,
     * actual_minutes from the dispatch time, first_attempt_success — written
     * FALSE on a failed first attempt too, so the rate is not 100% by
     * construction). Nothing wrote these columns before, so the calibration
     * loop and two of the location-accuracy numbers had no data source.
     * Optional and best-effort: a capture that fails never voids a truthfully
     * recorded delivery.
     */
    private readonly captureMirror?: IDeliveryCaptureMirror
  ) {}

  async execute(input: {
    taskId: string;
    actorId: string;
    outcome: FulfilmentDeliveryOutcome;
    /** 0190: the rider's point at handover (a WhatsApp location) and how the attempt reached us. */
    handover?: { lat: number; lng: number; accuracyM: number | null } | null;
    recordedVia?: 'office' | 'rider_whatsapp';
    deliveredQuantity?: number;
    returnedQuantity?: number;
    recipientName?: string | null;
    recipientConfirmation?: string | null;
    proofReference?: string | null;
    failedReason?: string | null;
    rescheduledFor?: Date | null;
    notes?: string | null;
    now?: Date;
  }): Promise<
    | {
        ok: true;
        delivery: FulfilmentDeliverySnapshot;
        completed: boolean;
        /** Whether the ORDER followed the outcome; 'skipped' is for the operator to see. */
        orderTransition?: 'delivered' | 'delivery_failed' | 'skipped' | 'not_wired';
      }
    | Fail
  > {
    const now = input.now ?? new Date();
    const snapshot = await this.tasks.findById(input.taskId);
    if (!snapshot) return fail('NOT_FOUND', 'Fulfilment task not found.');

    const guard = canRecordDelivery(snapshot.status);
    if (!guard.ok) {
      const messages = {
        TASK_ON_HOLD: 'Order is ON_HOLD and cannot take a delivery attempt.',
        TASK_NOT_OUT_FOR_DELIVERY: 'Order must be OUT_FOR_DELIVERY to record a delivery attempt.',
      } as const;
      return fail(guard.code, messages[guard.code]);
    }

    const deliveredQuantity = input.deliveredQuantity ?? (deliveryCompletesTask(input.outcome) ? Math.max(1, snapshot.itemCount) : 0);
    const returnedQuantity = input.returnedQuantity ?? 0;
    const valid = validateDelivery({
      outcome: input.outcome,
      deliveredQuantity,
      returnedQuantity,
      dispatchedQuantity: snapshot.itemCount,
      rescheduledFor: input.rescheduledFor,
      failedReason: input.failedReason,
    });
    if (!valid.ok) {
      const messages: Record<string, string> = {
        INVALID_QUANTITY: 'Delivery quantities are inconsistent with the dispatched order.',
        RESCHEDULE_DATE_REQUIRED: 'A reschedule date is required for a RESCHEDULED outcome.',
        FAILURE_REASON_REQUIRED: 'A reason is required for a DELIVERY_FAILED outcome.',
      };
      return fail(valid.code, messages[valid.code] ?? 'Invalid delivery.');
    }

    const attempt = (await this.deliveries.countByTask(input.taskId)) + 1;
    const { delivery } = await this.deliveries.create({
      fulfilmentTaskId: input.taskId,
      orderId: snapshot.orderId,
      attempt,
      outcome: input.outcome,
      deliveredAt: deliveryCompletesTask(input.outcome) ? now : null,
      recipientNameMasked: maskRecipientName(input.recipientName),
      recipientConfirmation: input.recipientConfirmation?.trim() || null,
      proofReference: input.proofReference?.trim() || null,
      failedReason: input.failedReason?.trim() || null,
      rescheduledFor: input.rescheduledFor ?? null,
      deliveredQuantity,
      returnedQuantity,
      notes: input.notes?.trim() || null,
      handover: input.handover ?? null,
      recordedVia: input.recordedVia ?? 'office',
    });

    // Only DELIVERED completes the lifecycle. Payment is deliberately untouched.
    let completed = false;
    if (deliveryCompletesTask(input.outcome)) {
      const task = FulfilmentTask.rehydrate(snapshot);
      try {
        task.transition('DELIVERED', { now });
        await this.tasks.update(task);
        completed = true;
      } catch {
        completed = false;
      }
    }

    // Mirror the outcome onto the order lifecycle. Best-effort by design: a
    // legacy order that never entered `dispatched` (or was closed manually)
    // refuses the transition in the state machine, and that refusal must not
    // void a truthfully recorded physical delivery attempt.
    let orderTransition: 'delivered' | 'delivery_failed' | 'skipped' | 'not_wired' = 'not_wired';
    if (this.orderTransitions) {
      const target =
        deliveryCompletesTask(input.outcome) ? ('delivered' as const)
        : input.outcome === 'DELIVERY_FAILED' ? ('delivery_failed' as const)
        : null; // RESCHEDULED and partials leave the order dispatched
      orderTransition = 'skipped';
      if (target) {
        const record = () =>
          this.orderTransitions!.transition(snapshot.orderId, target, {
            actorId: input.actorId,
            actorType: 'administrator',
            source: 'fulfilment',
            reasonCode: 'delivery_outcome',
            note: `Fulfilment attempt ${attempt}: ${input.outcome}`,
          });
        try {
          await record();
          orderTransition = target;
        } catch {
          // The order never followed the task to 'dispatched' — every COD
          // order dispatched before the dispatch mirror learned the legal
          // route. Catch it up the same way (confirm, then dispatch) and try
          // once more; each hop is legal and ledgered or commits nothing.
          const caughtUp = await mirrorOrderDispatched(this.orderTransitions, snapshot.orderId, {
            actorId: input.actorId,
            note: `Catch-up before recording attempt ${attempt}`,
            cashOnDelivery: snapshot.paymentStatus !== 'paid',
          });
          if (caughtUp === 'dispatched') {
            try {
              await record();
              orderTransition = target;
            } catch {
              orderTransition = 'skipped';
            }
          } else {
            orderTransition = 'skipped';
          }
        }
      }
    }

    if (this.captureMirror) {
      try {
        await this.captureMirror.recordAttempt({
          orderId: snapshot.orderId,
          taskId: input.taskId,
          attempt,
          completed,
          failedFirstAttempt: attempt === 1 && !deliveryCompletesTask(input.outcome),
          deliveredAt: deliveryCompletesTask(input.outcome) ? now : null,
        });
      } catch {
        // Best-effort by design: the capture is an observation for the model, never a condition of the delivery.
      }
    }
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'FULFILMENT_DELIVERY_RECORDED',
      entity: 'fulfilment_delivery',
      entityId: input.taskId,
      newState: { attempt, outcome: input.outcome, completed, deliveredQuantity, returnedQuantity, orderTransition },
    });
    return { ok: true, delivery, completed, orderTransition };
  }
}

export class GetFulfilmentReportUseCase {
  constructor(private readonly reports: IFulfilmentReportRepository) {}
  execute(now: Date = new Date()): Promise<FulfilmentReport> {
    return this.reports.buildReport(now);
  }
}
