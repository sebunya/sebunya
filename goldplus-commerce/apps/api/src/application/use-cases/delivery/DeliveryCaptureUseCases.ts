import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

/**
 * Calibration capture (brief PART 4).
 *
 * The audit found that actual rider cost is recorded NOWHERE — no field, no
 * route, no form. That makes the entire learning design dead on arrival,
 * because a model cannot fit margin against a cost it never saw. Rob moved the
 * capture into stage A for exactly that reason; this is the entry path that
 * makes the column reachable by a human.
 *
 * One row per order, upserted, so an ops correction replaces rather than
 * duplicates — and every write is audited, because a cost figure feeds pricing.
 */

export interface DeliveryCaptureRow {
  orderId: string;
  areaSlug: string | null;
  aliasUsed: string | null;
  corridor: string | null;
  distanceBand: string | null;
  quotedFeeUgx: number | null;
  finalFeeUgx: number | null;
  varianceReason: string | null;
  actualRiderCostUgx: number | null;
  expectedMinutes: number | null;
  actualMinutes: number | null;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  hadPin: boolean | null;
  firstAttemptSuccess: boolean | null;
  distanceTravelledKm: number | null;
  centroidSource: string | null;
  configVersionId: string | null;
  // 0093/0094 — HOW it was priced, and by what. Added to the row type at the
  // same time as the columns; the end-to-end proof found them missing here,
  // which silently dropped every one of them on write.
  fulfilmentMode: string | null;
  carrier: string | null;
  rateCardId: string | null;
  rateCardVersion: number | null;
  parcelClass: string | null;
  parcelCount: number | null;
  perParcelFeeUgx: number | null;
  parcelOfficeId: string | null;
  pricedBy: string | null;
}

export interface IDeliveryCaptureRepository {
  findByOrderId(orderId: string): Promise<DeliveryCaptureRow | null>;
  upsert(row: Partial<DeliveryCaptureRow> & { orderId: string }): Promise<DeliveryCaptureRow>;
  /** Rows where the delivery completed but nobody has entered what it cost. */
  listAwaitingCost(limit: number): Promise<Array<{ orderId: string; deliveredAt: Date | null; areaSlug: string | null }>>;
}

/**
 * Record what a delivery actually cost.
 *
 * Deliberately permissive about WHEN: a cost may be entered before or after the
 * delivery row exists, because in practice ops reconcile rider payments in a
 * batch at the end of a day rather than at the doorstep. Refusing an early
 * entry would push the number into a spreadsheet, which is where it lives today
 * and precisely the problem being fixed.
 */
export class RecordActualRiderCostUseCase {
  constructor(
    private readonly captures: IDeliveryCaptureRepository,
    private readonly audit: IAuditRepository,
    /**
     * The typo ceiling is a Tier 1 configuration value, not a literal — by this
     * module's own rule, a number a human might reasonably want to change does
     * not belong in code. Reads `implausible_rider_cost_ugx`.
     */
    private readonly ceilingUgx: () => Promise<number>,
  ) {}

  async execute(input: {
    orderId: string;
    actualRiderCostUgx: number;
    actorId: string;
    note?: string | null;
  }): Promise<{ ok: true; row: DeliveryCaptureRow } | Fail> {
    if (!Number.isInteger(input.actualRiderCostUgx) || input.actualRiderCostUgx < 0) {
      return fail('INVALID_COST', 'The rider cost must be a whole number of shillings, and cannot be negative.');
    }
    const ceiling = await this.ceilingUgx();
    if (input.actualRiderCostUgx > ceiling) {
      return fail(
        'IMPLAUSIBLE_COST',
        `That is above ${ceiling.toLocaleString()} UGX for one delivery — check the figure.`,
      );
    }
    const before = await this.captures.findByOrderId(input.orderId);
    const row = await this.captures.upsert({
      orderId: input.orderId,
      actualRiderCostUgx: input.actualRiderCostUgx,
    });
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'DELIVERY_ACTUAL_COST_RECORDED',
      entity: 'delivery_quote_capture',
      entityId: input.orderId,
      previousState: { actualRiderCostUgx: before?.actualRiderCostUgx ?? null },
      newState: { actualRiderCostUgx: input.actualRiderCostUgx, note: input.note ?? null },
    });
    return { ok: true, row };
  }
}

/**
 * Write the quote's own explanation at the moment it is given.
 *
 * Recording this now is far cheaper than backfilling it: once a fee is quoted,
 * the factors and sample sizes that produced it have already moved on, and no
 * later job can reconstruct which numbers were in force. Stage D reads these.
 */
export class CaptureQuoteUseCase {
  constructor(private readonly captures: IDeliveryCaptureRepository) {}

  async execute(input: {
    orderId: string;
    areaSlug: string | null;
    corridor: string | null;
    distanceBand: string | null;
    quotedFeeUgx: number | null;
    expectedMinutes: number | null;
    centroidSource: string | null;
    configVersionId: string | null;
    hadPin: boolean | null;
    aliasUsed: string | null;
  }): Promise<DeliveryCaptureRow> {
    return this.captures.upsert(input);
  }
}

/** Ops queue: delivered orders whose cost nobody has entered yet. */
export class ListDeliveriesAwaitingCostUseCase {
  constructor(private readonly captures: IDeliveryCaptureRepository) {}

  async execute(limit = 100) {
    return this.captures.listAwaitingCost(limit);
  }
}
