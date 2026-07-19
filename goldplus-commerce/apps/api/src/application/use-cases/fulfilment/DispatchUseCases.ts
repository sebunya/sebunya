import {
  FulfilmentDispatch,
  FulfilmentDispatchSnapshot,
  FulfilmentDispatchMethod,
  FulfilmentDispatchTrackingStatus,
  canDispatch,
  maskDispatchContact,
  buildDispatchReference,
} from '../../../domain/fulfilment/FulfilmentDispatch';
import { FulfilmentTask } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IFulfilmentDispatchRepository } from '../../ports/IFulfilmentDispatchRepository';
import { IInventoryRepository } from '../../ports/IInventoryRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

export type DispatchError =
  | 'NOT_FOUND'
  | 'TASK_ON_HOLD'
  | 'TASK_NOT_DISPATCHABLE'
  | 'NOT_READY_FOR_DISPATCH'
  | 'PAYMENT_NOT_CLEARED'
  | 'NO_DISPATCH'
  | 'STALE_DISPATCH_VERSION'
  | 'INVALID_INPUT';

type Fail = { ok: false; code: DispatchError; message: string };
const fail = (code: DispatchError, message: string): Fail => ({ ok: false, code, message });

async function audit(auditRepo: IAuditRepository, actorId: string, action: string, entityId: string, newState: unknown, previousState?: unknown) {
  await new CreateAuditLogUseCase(auditRepo).execute({ actorId, action, entity: 'fulfilment_dispatch', entityId, previousState, newState });
}

export class GetDispatchUseCase {
  constructor(
    private readonly tasks: IFulfilmentRepository,
    private readonly dispatches: IFulfilmentDispatchRepository
  ) {}
  async execute(taskId: string): Promise<{ ok: true; dispatch: FulfilmentDispatchSnapshot | null; status: string } | Fail> {
    const task = await this.tasks.findById(taskId);
    if (!task) return fail('NOT_FOUND', 'Fulfilment task not found.');
    const dispatch = await this.dispatches.getByTask(taskId);
    return { ok: true, dispatch, status: task.status };
  }
}

/**
 * Record the single dispatch for a task and advance it to OUT_FOR_DELIVERY.
 *
 * Dispatch is only permitted from READY_FOR_DISPATCH — the point at which stock
 * was already consumed exactly once. This use case NEVER consumes stock; it reads
 * the reservation summary purely to record a truthful stock-consumed flag. It is
 * idempotent: a second call returns the existing dispatch without a second record,
 * a second transition, or any inventory effect.
 */
export class RecordDispatchUseCase {
  constructor(
    private readonly tasks: IFulfilmentRepository,
    private readonly dispatches: IFulfilmentDispatchRepository,
    private readonly inventory: IInventoryRepository,
    private readonly audit: IAuditRepository
  ) {}

  async execute(input: {
    taskId: string;
    actorId: string;
    method: FulfilmentDispatchMethod;
    carrierName?: string | null;
    riderName?: string | null;
    contact?: string | null;
    estimatedDeliveryAt?: Date | null;
    notes?: string | null;
    allowCashOnDelivery?: boolean;
    now?: Date;
  }): Promise<{ ok: true; dispatch: FulfilmentDispatchSnapshot; created: boolean } | Fail> {
    const now = input.now ?? new Date();
    const snapshot = await this.tasks.findById(input.taskId);
    if (!snapshot) return fail('NOT_FOUND', 'Fulfilment task not found.');

    // Idempotent: if a dispatch already exists, return it unchanged — no second
    // record, no re-transition, no inventory effect.
    const existing = await this.dispatches.getByTask(input.taskId);
    if (existing) return { ok: true, dispatch: existing, created: false };

    const guard = canDispatch({
      status: snapshot.status,
      paymentStatus: snapshot.paymentStatus,
      allowCashOnDelivery: !!input.allowCashOnDelivery,
    });
    if (!guard.ok) {
      const messages: Record<string, string> = {
        TASK_ON_HOLD: 'Order is ON_HOLD and cannot be dispatched.',
        TASK_NOT_DISPATCHABLE: `Order is ${snapshot.status} and cannot be dispatched.`,
        NOT_READY_FOR_DISPATCH: 'Order must be packed and READY_FOR_DISPATCH before dispatch.',
        PAYMENT_NOT_CLEARED: 'Payment is not cleared. Confirm cash-on-delivery to dispatch an unpaid order.',
      };
      return fail(guard.code, messages[guard.code] ?? 'Dispatch not permitted.');
    }

    // Truthful stock-consumed flag from the real reservation ledger (never inferred).
    const reservations = await this.inventory.summariseReservations(snapshot.orderId);

    const { created, dispatch } = await this.dispatches.create({
      fulfilmentTaskId: input.taskId,
      orderId: snapshot.orderId,
      dispatchReference: buildDispatchReference(snapshot.orderNumber, now),
      method: input.method,
      carrierName: input.carrierName?.trim() || null,
      riderName: input.riderName?.trim() || null,
      contactMasked: maskDispatchContact(input.contact),
      paymentPolicy: guard.paymentPolicy,
      trackingStatus: 'DISPATCHED',
      stockConsumed: reservations.fullyConsumed,
      dispatchTime: now,
      estimatedDeliveryAt: input.estimatedDeliveryAt ?? null,
      notes: input.notes?.trim() || null,
    });

    // Lost a race to a concurrent dispatch — return the winner, still no re-effect.
    if (!created) return { ok: true, dispatch, created: false };

    // Advance the lifecycle READY_FOR_DISPATCH → OUT_FOR_DELIVERY (single point).
    const task = FulfilmentTask.rehydrate(snapshot);
    try {
      task.transition('OUT_FOR_DELIVERY', { now });
      await this.tasks.update(task);
    } catch {
      // Dispatch is recorded; the status advance is best-effort and audited below.
    }

    await audit(this.audit, input.actorId, 'FULFILMENT_DISPATCHED', input.taskId, {
      dispatchReference: dispatch.dispatchReference,
      method: dispatch.method,
      paymentPolicy: dispatch.paymentPolicy,
      stockConsumed: dispatch.stockConsumed,
    });
    return { ok: true, dispatch, created: true };
  }
}

/** Update dispatch tracking (status/ETA/notes) with optimistic concurrency. */
export class UpdateDispatchTrackingUseCase {
  constructor(
    private readonly dispatches: IFulfilmentDispatchRepository,
    private readonly audit: IAuditRepository
  ) {}
  async execute(input: {
    taskId: string;
    actorId: string;
    expectedVersion: number;
    trackingStatus?: FulfilmentDispatchTrackingStatus;
    estimatedDeliveryAt?: Date | null;
    notes?: string | null;
  }): Promise<{ ok: true; dispatch: FulfilmentDispatchSnapshot } | Fail> {
    const snap = await this.dispatches.getByTask(input.taskId);
    if (!snap) return fail('NO_DISPATCH', 'No dispatch has been recorded for this task.');
    if (snap.version !== input.expectedVersion) return fail('STALE_DISPATCH_VERSION', 'Dispatch was modified concurrently.');
    const dispatch = FulfilmentDispatch.rehydrate(snap);
    dispatch.updateTracking({
      trackingStatus: input.trackingStatus,
      estimatedDeliveryAt: input.estimatedDeliveryAt,
      notes: input.notes,
    });
    const res = await this.dispatches.updateWithVersion(dispatch, input.expectedVersion);
    if (!res.updated) return fail('STALE_DISPATCH_VERSION', 'Dispatch was modified concurrently.');
    await audit(this.audit, input.actorId, 'FULFILMENT_DISPATCH_TRACKING_UPDATED', input.taskId,
      { trackingStatus: dispatch.trackingStatus }, { trackingStatus: snap.trackingStatus });
    return { ok: true, dispatch: dispatch.toSnapshot() };
  }
}
