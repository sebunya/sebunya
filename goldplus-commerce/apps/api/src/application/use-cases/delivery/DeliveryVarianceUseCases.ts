import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { VarianceReason, decideVariance, isVarianceReason } from '../../../domain/delivery/DeliveryVariance';

/**
 * The variance WRITE path (brief PART 5).
 *
 * `decideVariance` decides; this applies. Everything the brief requires of an
 * applied variance happens here and cannot be skipped by a caller:
 *
 *   * the reason must be on the closed list — `RIDER_COVERED_MORE_GROUND` is
 *     refused, because that is a modelling error GoldPlus absorbs;
 *   * inside the absorption threshold it is absorbed SILENTLY and the customer
 *     is not contacted;
 *   * above it, the customer's agreement is required BEFORE dispatch, never
 *     after handover;
 *   * every variance writes old fee, new fee, reason, actor, timestamp and
 *     agreement to the order audit. No variance is ever silent to US, even when
 *     it is silent to the customer;
 *   * a customer who declines may cancel without penalty.
 *
 * The rider has no authority over the amount and no path here takes rider
 * input. The cash-on-delivery figure on the card is the order total, full stop.
 */

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

export type AgreementState = 'not_required' | 'pending' | 'agreed' | 'declined';

export interface VarianceRecord {
  id: string;
  orderId: string;
  oldFeeUgx: number;
  newFeeUgx: number;
  deltaUgx: number;
  reason: VarianceReason;
  note: string | null;
  disposition: 'absorbed' | 'needs_agreement';
  agreement: AgreementState;
  appliedBy: string;
  appliedAt: Date;
  agreementBy: string | null;
  agreementAt: Date | null;
  /** Set only when a declining customer cancels. */
  cancelledOrder: boolean;
}

export interface IDeliveryVarianceRepository {
  orderForVariance(orderId: string): Promise<{
    id: string;
    orderNumber: string;
    deliveryFeeUgx: number;
    status: string;
    /** Once the goods are with the customer the amount is settled. */
    handedOver: boolean;
  } | null>;
  insert(record: Omit<VarianceRecord, 'id'>): Promise<VarianceRecord>;
  findById(varianceId: string): Promise<VarianceRecord | null>;
  /** Only applied on `absorbed`, or on `agreed`. Never on `pending`. */
  applyFeeToOrder(input: { orderId: string; newFeeUgx: number }): Promise<void>;
  setAgreement(input: {
    varianceId: string;
    agreement: AgreementState;
    actorId: string;
    at: Date;
  }): Promise<VarianceRecord>;
  listPendingAgreement(limit: number): Promise<VarianceRecord[]>;
  listForOrder(orderId: string): Promise<VarianceRecord[]>;
}

export class ApplyDeliveryVarianceUseCase {
  constructor(
    private readonly repo: IDeliveryVarianceRepository,
    private readonly audit: IAuditRepository,
    private readonly thresholds: () => Promise<{ absoluteUgx: number | null; shareBps: number | null }>,
    private readonly captures: { upsert(row: { orderId: string } & Record<string, unknown>): Promise<unknown> },
  ) {}

  async execute(input: {
    orderId: string;
    newFeeUgx: number;
    reason: string;
    note: string | null;
    actorId: string;
  }): Promise<{ ok: true; variance: VarianceRecord } | Fail> {
    if (!Number.isInteger(input.newFeeUgx) || input.newFeeUgx < 0) {
      return fail('INVALID_FEE', 'The new delivery fee must be a whole number of shillings and cannot be negative.');
    }
    const order = await this.repo.orderForVariance(input.orderId);
    if (!order) return fail('ORDER_NOT_FOUND', 'That order does not exist.');

    const threshold = await this.thresholds();
    const decision = decideVariance({
      reason: input.reason,
      oldFeeUgx: order.deliveryFeeUgx,
      newFeeUgx: input.newFeeUgx,
      note: input.note,
      handedOver: order.handedOver,
      threshold,
    });
    if (!decision.ok) return fail(decision.refusal, decision.message);

    const now = new Date();
    const needsAgreement = decision.disposition.kind === 'needs_agreement';
    const record = await this.repo.insert({
      orderId: order.id,
      oldFeeUgx: order.deliveryFeeUgx,
      newFeeUgx: input.newFeeUgx,
      deltaUgx: decision.disposition.deltaUgx,
      reason: decision.reason,
      note: input.note,
      disposition: decision.disposition.kind,
      // Below the threshold nothing is asked of the customer. Above it, the
      // fee does NOT move until they agree — that is the whole control.
      agreement: needsAgreement ? 'pending' : 'not_required',
      appliedBy: input.actorId,
      appliedAt: now,
      agreementBy: null,
      agreementAt: null,
      cancelledOrder: false,
    });

    if (!needsAgreement) {
      await this.repo.applyFeeToOrder({ orderId: order.id, newFeeUgx: input.newFeeUgx });
      await this.captures.upsert({ orderId: order.id, finalFeeUgx: input.newFeeUgx, varianceReason: decision.reason });
    }

    // Old, new, reason, actor, timestamp and agreement. Every field the brief
    // names, on every variance including the silently absorbed ones.
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'DELIVERY_VARIANCE_APPLIED',
      entity: 'order',
      entityId: order.id,
      previousState: { deliveryFeeUgx: order.deliveryFeeUgx },
      newState: {
        deliveryFeeUgx: input.newFeeUgx,
        deltaUgx: decision.disposition.deltaUgx,
        reason: decision.reason,
        note: input.note,
        disposition: decision.disposition.kind,
        agreement: record.agreement,
        varianceId: record.id,
        appliedAt: now.toISOString(),
        // Explicit, so a reader never has to infer it from a missing field.
        customerContacted: needsAgreement,
        feeApplied: !needsAgreement,
      },
    });
    return { ok: true, variance: record };
  }
}

/**
 * Record the customer's answer.
 *
 * Agreement must be obtained BEFORE dispatch or redelivery, never after
 * handover, so this refuses once the goods are with the customer. A decline is
 * a real outcome with a real consequence: the fee does not change, and the
 * customer may cancel without penalty.
 */
export class RecordVarianceAgreementUseCase {
  constructor(
    private readonly repo: IDeliveryVarianceRepository,
    private readonly audit: IAuditRepository,
    private readonly captures: { upsert(row: { orderId: string } & Record<string, unknown>): Promise<unknown> },
    /** Cancels without penalty. Null when no cancellation path is wired. */
    private readonly cancelOrder: ((input: { orderId: string; reason: string; actorId: string }) => Promise<void>) | null,
  ) {}

  async execute(input: {
    varianceId: string;
    agreed: boolean;
    /** Only meaningful on a decline. */
    cancelOrder?: boolean;
    actorId: string;
  }): Promise<{ ok: true; variance: VarianceRecord } | Fail> {
    const existing = await this.repo.findById(input.varianceId);
    if (!existing) return fail('VARIANCE_NOT_FOUND', 'That variance does not exist.');
    if (existing.agreement !== 'pending') {
      return fail('NOT_AWAITING_AGREEMENT', 'That variance is not waiting for the customer’s answer.');
    }
    const order = await this.repo.orderForVariance(existing.orderId);
    if (!order) return fail('ORDER_NOT_FOUND', 'That order does not exist.');
    if (order.handedOver) {
      return fail('ORDER_ALREADY_HANDED_OVER', 'The goods are already with the customer. The amount is settled.');
    }

    const now = new Date();
    const updated = await this.repo.setAgreement({
      varianceId: input.varianceId,
      agreement: input.agreed ? 'agreed' : 'declined',
      actorId: input.actorId,
      at: now,
    });

    let cancelled = false;
    if (input.agreed) {
      // Only NOW does the fee move.
      await this.repo.applyFeeToOrder({ orderId: existing.orderId, newFeeUgx: existing.newFeeUgx });
      await this.captures.upsert({
        orderId: existing.orderId,
        finalFeeUgx: existing.newFeeUgx,
        varianceReason: existing.reason,
      });
    } else if (input.cancelOrder && this.cancelOrder) {
      // "A customer declining a variance may cancel without penalty."
      await this.cancelOrder({
        orderId: existing.orderId,
        reason: 'Customer declined a delivery fee change. Cancelled without penalty.',
        actorId: input.actorId,
      });
      cancelled = true;
    }

    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'DELIVERY_VARIANCE_AGREEMENT_RECORDED',
      entity: 'order',
      entityId: existing.orderId,
      previousState: { agreement: 'pending', deliveryFeeUgx: existing.oldFeeUgx },
      newState: {
        agreement: input.agreed ? 'agreed' : 'declined',
        deliveryFeeUgx: input.agreed ? existing.newFeeUgx : existing.oldFeeUgx,
        varianceId: existing.id,
        recordedAt: now.toISOString(),
        cancelledWithoutPenalty: cancelled,
      },
    });
    return { ok: true, variance: { ...updated, cancelledOrder: cancelled } };
  }
}

/** Ops queue: variances waiting on a customer before anything can dispatch. */
export class ListPendingVarianceAgreementsUseCase {
  constructor(private readonly repo: IDeliveryVarianceRepository) {}
  async execute(limit = 100) {
    return this.repo.listPendingAgreement(limit);
  }
}

/** For the order inspector: every variance ever applied to one order. */
export class ListOrderVariancesUseCase {
  constructor(private readonly repo: IDeliveryVarianceRepository) {}
  async execute(orderId: string) {
    return this.repo.listForOrder(orderId);
  }
}

/** Re-exported so a route never spells a reason string itself. */
export { isVarianceReason };
