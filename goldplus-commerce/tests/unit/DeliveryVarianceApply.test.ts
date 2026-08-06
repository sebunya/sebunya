import { describe, it, expect, beforeEach } from 'vitest';
import {
  ApplyDeliveryVarianceUseCase,
  IDeliveryVarianceRepository,
  RecordVarianceAgreementUseCase,
  VarianceRecord,
} from '../../apps/api/src/application/use-cases/delivery/DeliveryVarianceUseCases';

/**
 * The variance WRITE path.
 *
 * NO LIVE ORDERS EXERCISE THIS. Every production order is unpaid and none has
 * been delivered, so everything below is synthetic against an in-memory fake.
 * That is stated here and in the report, in the results rather than a footnote.
 */

const ORDER = { id: 'order-1', orderNumber: 'GP-TEST-0001', deliveryFeeUgx: 7500, status: 'processing', handedOver: false };

class FakeRepo implements IDeliveryVarianceRepository {
  order = { ...ORDER };
  records: VarianceRecord[] = [];
  feeApplications: Array<{ orderId: string; newFeeUgx: number }> = [];
  seq = 0;

  async orderForVariance(orderId: string) {
    return orderId === this.order.id ? { ...this.order } : null;
  }
  async insert(record: Omit<VarianceRecord, 'id'>) {
    const full = { ...record, id: `v-${++this.seq}` };
    this.records.push(full);
    return full;
  }
  async findById(id: string) {
    return this.records.find((r) => r.id === id) ?? null;
  }
  async applyFeeToOrder(input: { orderId: string; newFeeUgx: number }) {
    this.feeApplications.push(input);
    this.order.deliveryFeeUgx = input.newFeeUgx;
  }
  async setAgreement(input: { varianceId: string; agreement: VarianceRecord['agreement']; actorId: string; at: Date }) {
    const r = this.records.find((x) => x.id === input.varianceId)!;
    r.agreement = input.agreement;
    r.agreementBy = input.actorId;
    r.agreementAt = input.at;
    return r;
  }
  async listPendingAgreement() {
    return this.records.filter((r) => r.agreement === 'pending');
  }
  async listForOrder(orderId: string) {
    return this.records.filter((r) => r.orderId === orderId);
  }
}

class FakeAudit {
  entries: any[] = [];
  async save(entry: any) {
    this.entries.push(entry);
    return entry;
  }
  async list() {
    return [];
  }
  async findByEntity() {
    return [];
  }
}

const captures = { rows: [] as any[], async upsert(row: any) { this.rows.push(row); return row; } };

let repo: FakeRepo;
let audit: FakeAudit;
let cancelled: Array<{ orderId: string; reason: string }>;

const THRESHOLD = { absoluteUgx: 2000, shareBps: 2000 };

const apply = (threshold = THRESHOLD) =>
  new ApplyDeliveryVarianceUseCase(repo, audit as any, async () => threshold, captures);

const agree = () =>
  new RecordVarianceAgreementUseCase(repo, audit as any, captures, async (input) => {
    cancelled.push({ orderId: input.orderId, reason: input.reason });
  });

beforeEach(() => {
  repo = new FakeRepo();
  audit = new FakeAudit();
  captures.rows = [];
  cancelled = [];
});

describe('a placed fee cannot change for a reason outside the list — the test that TRIES', () => {
  it('refuses RIDER_COVERED_MORE_GROUND and says why', async () => {
    const r = await apply().execute({
      orderId: 'order-1',
      newFeeUgx: 12_000,
      reason: 'RIDER_COVERED_MORE_GROUND',
      note: null,
      actorId: 'ops-1',
    });
    expect(r).toMatchObject({ ok: false, code: 'REASON_NOT_PERMITTED' });
    // Nothing was written, nothing was applied, nothing was audited as a change.
    expect(repo.records).toHaveLength(0);
    expect(repo.feeApplications).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
    // And the order's fee is untouched.
    expect(repo.order.deliveryFeeUgx).toBe(7500);
  });

  it('refuses other plausible inventions', async () => {
    for (const reason of ['FUEL_PRICE_ROSE', 'TRAFFIC_WAS_BAD', 'RIDER_ASKED', '']) {
      const r = await apply().execute({ orderId: 'order-1', newFeeUgx: 9000, reason, note: null, actorId: 'ops-1' });
      expect(r.ok, reason).toBe(false);
    }
    expect(repo.feeApplications).toHaveLength(0);
  });
});

describe('absorption below the threshold is silent to the customer, never to us', () => {
  it('applies the fee immediately and contacts nobody', async () => {
    const r = await apply().execute({
      orderId: 'order-1',
      newFeeUgx: 8000,
      reason: 'AREA_MISMATCH_ON_RESOLUTION',
      note: null,
      actorId: 'ops-1',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variance.disposition).toBe('absorbed');
    expect(r.variance.agreement).toBe('not_required');
    expect(repo.feeApplications).toEqual([{ orderId: 'order-1', newFeeUgx: 8000 }]);
    const entry = audit.entries[0];
    expect(entry.newState.customerContacted).toBe(false);
  });

  it('writes old, new, reason, actor, timestamp and agreement to the audit', async () => {
    await apply().execute({
      orderId: 'order-1',
      newFeeUgx: 8000,
      reason: 'ADDRESS_CHANGED_BY_CUSTOMER',
      note: null,
      actorId: 'ops-7',
    });
    const e = audit.entries[0];
    expect(e.action).toBe('DELIVERY_VARIANCE_APPLIED');
    expect(e.previousState.deliveryFeeUgx).toBe(7500); // old
    expect(e.newState.deliveryFeeUgx).toBe(8000); // new
    expect(e.newState.reason).toBe('ADDRESS_CHANGED_BY_CUSTOMER'); // reason
    expect(e.actorId).toBe('ops-7'); // actor
    expect(typeof e.newState.appliedAt).toBe('string'); // timestamp
    expect(e.newState.agreement).toBe('not_required'); // agreement
  });

  it('records the final fee on the capture, so calibration sees what was charged', async () => {
    await apply().execute({ orderId: 'order-1', newFeeUgx: 8000, reason: 'ACCESS_MODE_DIFFERENT', note: null, actorId: 'o' });
    expect(captures.rows[0]).toMatchObject({ orderId: 'order-1', finalFeeUgx: 8000, varianceReason: 'ACCESS_MODE_DIFFERENT' });
  });
});

describe('above the threshold the fee does NOT move until the customer agrees', () => {
  const big = () =>
    apply().execute({
      orderId: 'order-1',
      newFeeUgx: 20_000,
      reason: 'AREA_MISMATCH_ON_RESOLUTION',
      note: null,
      actorId: 'ops-1',
    });

  it('holds the fee and marks the variance pending', async () => {
    const r = await big();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variance.disposition).toBe('needs_agreement');
    expect(r.variance.agreement).toBe('pending');
    // THE control: nothing was applied.
    expect(repo.feeApplications).toHaveLength(0);
    expect(repo.order.deliveryFeeUgx).toBe(7500);
    expect(audit.entries[0].newState.feeApplied).toBe(false);
    expect(audit.entries[0].newState.customerContacted).toBe(true);
  });

  it('applies the fee only once the customer agrees', async () => {
    const applied = await big();
    if (!applied.ok) throw new Error('expected ok');
    const r = await agree().execute({ varianceId: applied.variance.id, agreed: true, actorId: 'ops-2' });
    expect(r.ok).toBe(true);
    expect(repo.feeApplications).toEqual([{ orderId: 'order-1', newFeeUgx: 20_000 }]);
    expect(repo.order.deliveryFeeUgx).toBe(20_000);
  });

  it('leaves the fee alone on a decline', async () => {
    const applied = await big();
    if (!applied.ok) throw new Error('expected ok');
    await agree().execute({ varianceId: applied.variance.id, agreed: false, actorId: 'ops-2' });
    expect(repo.feeApplications).toHaveLength(0);
    expect(repo.order.deliveryFeeUgx).toBe(7500);
    expect(audit.entries.at(-1).newState.agreement).toBe('declined');
  });

  it('lets a declining customer cancel WITHOUT PENALTY', async () => {
    const applied = await big();
    if (!applied.ok) throw new Error('expected ok');
    const r = await agree().execute({
      varianceId: applied.variance.id,
      agreed: false,
      cancelOrder: true,
      actorId: 'ops-2',
    });
    expect(r.ok).toBe(true);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].reason).toContain('without penalty');
    expect(audit.entries.at(-1).newState.cancelledWithoutPenalty).toBe(true);
  });

  it('refuses a second answer once one is recorded', async () => {
    const applied = await big();
    if (!applied.ok) throw new Error('expected ok');
    await agree().execute({ varianceId: applied.variance.id, agreed: true, actorId: 'ops-2' });
    const again = await agree().execute({ varianceId: applied.variance.id, agreed: false, actorId: 'ops-3' });
    expect(again).toMatchObject({ ok: false, code: 'NOT_AWAITING_AGREEMENT' });
  });

  it('surfaces pending variances in the ops queue', async () => {
    await big();
    expect(await repo.listPendingAgreement()).toHaveLength(1);
  });
});

describe('the controls that cannot be argued with', () => {
  it('refuses any change once the goods are with the customer', async () => {
    repo.order.status = 'delivered';
    repo.order.handedOver = true;
    const r = await apply().execute({
      orderId: 'order-1',
      newFeeUgx: 9000,
      reason: 'REDELIVERY_AFTER_FAILED_ATTEMPT',
      note: null,
      actorId: 'ops-1',
    });
    expect(r).toMatchObject({ ok: false, code: 'ORDER_ALREADY_HANDED_OVER' });
  });

  it('refuses agreement after handover, even on a pending variance', async () => {
    const applied = await apply().execute({
      orderId: 'order-1',
      newFeeUgx: 20_000,
      reason: 'AREA_MISMATCH_ON_RESOLUTION',
      note: null,
      actorId: 'ops-1',
    });
    if (!applied.ok) throw new Error('expected ok');
    repo.order.status = 'delivered';
    repo.order.handedOver = true;
    const r = await agree().execute({ varianceId: applied.variance.id, agreed: true, actorId: 'ops-2' });
    expect(r).toMatchObject({ ok: false, code: 'ORDER_ALREADY_HANDED_OVER' });
    expect(repo.feeApplications).toHaveLength(0);
  });

  it('refuses when the absorption threshold is unset rather than absorbing without limit', async () => {
    const r = await apply({ absoluteUgx: null, shareBps: null }).execute({
      orderId: 'order-1',
      newFeeUgx: 90_000,
      reason: 'AREA_MISMATCH_ON_RESOLUTION',
      note: null,
      actorId: 'ops-1',
    });
    expect(r).toMatchObject({ ok: false, code: 'THRESHOLD_NOT_CONFIGURED' });
    expect(repo.feeApplications).toHaveLength(0);
  });

  it('makes the catch-all reason explain itself', async () => {
    const bare = await apply().execute({
      orderId: 'order-1',
      newFeeUgx: 8000,
      reason: 'MANUAL_ADJUSTMENT_BY_OPS',
      note: null,
      actorId: 'ops-1',
    });
    expect(bare).toMatchObject({ ok: false, code: 'REASON_REQUIRES_NOTE' });
    const withNote = await apply().execute({
      orderId: 'order-1',
      newFeeUgx: 8000,
      reason: 'MANUAL_ADJUSTMENT_BY_OPS',
      note: 'customer moved across town after ordering',
      actorId: 'ops-1',
    });
    expect(withNote.ok).toBe(true);
  });

  it('refuses a negative or fractional fee', async () => {
    for (const fee of [-1, 8000.5, Number.NaN]) {
      const r = await apply().execute({
        orderId: 'order-1',
        newFeeUgx: fee,
        reason: 'ADDRESS_CHANGED_BY_CUSTOMER',
        note: null,
        actorId: 'ops-1',
      });
      expect(r, String(fee)).toMatchObject({ ok: false, code: 'INVALID_FEE' });
    }
  });

  it('never asks the customer to agree a REDUCTION', async () => {
    const r = await apply().execute({
      orderId: 'order-1',
      newFeeUgx: 1000,
      reason: 'AREA_MISMATCH_ON_RESOLUTION',
      note: null,
      actorId: 'ops-1',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variance.disposition).toBe('absorbed');
    expect(repo.feeApplications).toEqual([{ orderId: 'order-1', newFeeUgx: 1000 }]);
  });
});
