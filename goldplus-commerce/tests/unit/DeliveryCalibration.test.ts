import { describe, it, expect, beforeEach } from 'vitest';
import {
  Observation,
  explainEmptiness,
  fitDetourFactor,
  fitLastMileSplit,
  fitRatioFactor,
  fitWindowPercentiles,
  flagRebands,
} from '../../apps/api/src/domain/delivery/DeliveryCalibration';
import {
  AcceptCalibrationProposalUseCase,
  CalibrationProposal,
  ICalibrationRepository,
  RunNightlyCalibrationUseCase,
} from '../../apps/api/src/application/use-cases/delivery/DeliveryCalibrationUseCases';
import { DELIVERY_CONFIG_REGISTRY } from '../../apps/api/src/domain/delivery/DeliveryConfigRegistry';

/**
 * The learning loop, fitted against ZERO observations.
 *
 * Everything here is proven against fixtures and NOTHING against real traffic.
 * No order has been delivered, no rider cost recorded, no factor fitted. The
 * five rules all have to hold in that state, because that is the state this
 * ships in.
 */

const obs = (over: Partial<Observation> = {}): Observation => ({
  areaSlug: 'kampala-ntinda-10101',
  corridor: 'kira_rd',
  eatHourOfWeek: 38,
  predictedMinutes: 60,
  actualMinutes: 60,
  straightLineKm: 7,
  distanceTravelledKm: 14,
  hadPin: null,
  quotedFeeUgx: 9000,
  finalFeeUgx: 9000,
  actualRiderCostUgx: 6500,
  varianceReason: null,
  ...over,
});

describe('rule 3 — every division is guarded, at n=0 and n=1', () => {
  it('fitRatioFactor at n=0 returns insufficient_data, never NaN', () => {
    const r = fitRatioFactor({ observations: [], minSample: 5, prior: 1 });
    expect(r).toMatchObject({ kind: 'insufficient_data', sampleSize: 0, reason: 'no_usable_observations' });
    expect(r.kind === 'insufficient_data' && r.needed).toBe(5);
  });

  it('fitRatioFactor at n=1 below the minimum says how many more are needed', () => {
    const r = fitRatioFactor({ observations: [obs()], minSample: 5, prior: 1 });
    expect(r).toMatchObject({ kind: 'insufficient_data', sampleSize: 1, needed: 4, reason: 'below_minimum_sample' });
  });

  it('fitRatioFactor at n=1 WITH a minimum of 1 fits', () => {
    const r = fitRatioFactor({ observations: [obs({ actualMinutes: 90, predictedMinutes: 60 })], minSample: 1, prior: 1 });
    expect(r.kind).toBe('fitted');
    if (r.kind !== 'fitted') return;
    expect(r.factor.value).toBeCloseTo(1.5, 10);
    expect(r.factor.sampleSize).toBe(1);
  });

  it('never divides by a zero predicted time', () => {
    const r = fitRatioFactor({ observations: [obs({ predictedMinutes: 0 })], minSample: 1, prior: 1 });
    expect(r).toMatchObject({ kind: 'insufficient_data' });
  });

  it('drops observations with a missing side rather than defaulting them', () => {
    const r = fitRatioFactor({
      observations: [obs(), obs({ actualMinutes: null }), obs({ predictedMinutes: null })],
      minSample: 1,
      prior: 1,
    });
    expect(r.kind === 'fitted' && r.sampleSize).toBe(1);
  });

  it('fitDetourFactor is guarded at n=0 and at a zero straight line', () => {
    expect(fitDetourFactor({ observations: [], minSample: 3 })).toMatchObject({ kind: 'insufficient_data', sampleSize: 0 });
    expect(fitDetourFactor({ observations: [obs({ straightLineKm: 0 })], minSample: 1 })).toMatchObject({
      kind: 'insufficient_data',
    });
  });

  it('fitDetourFactor at n=1 fits the ratio it can see', () => {
    const r = fitDetourFactor({ observations: [obs({ straightLineKm: 10, distanceTravelledKm: 13 })], minSample: 1 });
    expect(r.kind === 'fitted' && r.factor.value).toBeCloseTo(1.3, 10);
  });

  it('fitLastMileSplit is guarded on both halves at n=0', () => {
    const s = fitLastMileSplit({ observations: [], minSample: 3 });
    expect(s.withPin).toMatchObject({ kind: 'insufficient_data', sampleSize: 0 });
    expect(s.withoutPin).toMatchObject({ kind: 'insufficient_data', sampleSize: 0 });
    expect(s.savingMinutes).toBeNull();
  });

  it('gives NO pin time saving until BOTH halves have a sample', () => {
    // This is why the pin nudge ships with no time claim.
    const onlyWithPin = fitLastMileSplit({
      observations: [obs({ hadPin: true, actualMinutes: 65 })],
      minSample: 1,
    });
    expect(onlyWithPin.withPin.kind).toBe('fitted');
    expect(onlyWithPin.withoutPin.kind).toBe('insufficient_data');
    expect(onlyWithPin.savingMinutes).toBeNull();

    const both = fitLastMileSplit({
      observations: [obs({ hadPin: true, actualMinutes: 65 }), obs({ hadPin: false, actualMinutes: 80 })],
      minSample: 1,
    });
    expect(both.savingMinutes).toBeCloseTo(15, 10);
  });

  it('window percentiles refuse a percentile of nothing, and of too little', () => {
    expect(fitWindowPercentiles({ observations: [], minSample: 5, lowPct: 10, highPct: 90 })).toBeNull();
    expect(fitWindowPercentiles({ observations: [obs()], minSample: 5, lowPct: 10, highPct: 90 })).toBeNull();
  });

  it('window percentiles never index off either end of the sample', () => {
    const r = fitWindowPercentiles({
      observations: [obs({ actualMinutes: 30 }), obs({ actualMinutes: 60 }), obs({ actualMinutes: 90 })],
      minSample: 1,
      lowPct: 0,
      highPct: 100,
    });
    expect(r).toEqual({ p10: 30, p90: 90, sampleSize: 3 });
  });
});

describe('rule 2 — no proposal below the minimum, and none at all without one', () => {
  it('an UNSET minimum means no proposals, not a default threshold', () => {
    const r = fitRatioFactor({ observations: Array.from({ length: 500 }, () => obs()), minSample: null, prior: 1 });
    expect(r).toMatchObject({ kind: 'insufficient_data', reason: 'no_minimum_configured', needed: null });
  });

  it('the minimum is declared in the registry and ships unset', () => {
    const entry = DELIVERY_CONFIG_REGISTRY.find((e) => e.key === 'calibration_min_sample_size')!;
    expect(entry).toBeTruthy();
    expect(entry.defaultValue).toBeNull();
    expect(entry.tier).toBe(1);
  });

  it('flagRebands proposes nothing without a minimum', () => {
    expect(
      flagRebands({
        areas: [{ areaSlug: 'a', seededBand: 'B2', measuredKm: [20, 21, 22] }],
        bandFor: () => 'B4',
        minSample: null,
      }),
    ).toEqual([]);
  });

  it('flagRebands FLAGS, and only above the minimum', () => {
    const flags = flagRebands({
      areas: [{ areaSlug: 'a', seededBand: 'B2', measuredKm: [20, 21, 22] }],
      bandFor: () => 'B4',
      minSample: 3,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ areaSlug: 'a', seededBand: 'B2', suggestedBand: 'B4', measuredMedianKm: 21 });
    // Below the minimum, nothing.
    expect(
      flagRebands({ areas: [{ areaSlug: 'a', seededBand: 'B2', measuredKm: [20] }], bandFor: () => 'B4', minSample: 3 }),
    ).toEqual([]);
  });

  it('flagRebands says nothing when the band already agrees', () => {
    expect(
      flagRebands({ areas: [{ areaSlug: 'a', seededBand: 'B4', measuredKm: [20, 21, 22] }], bandFor: () => 'B4', minSample: 3 }),
    ).toEqual([]);
  });
});

describe('reports render their own emptiness in WORDS', () => {
  it('says what exists, what is missing, and what would need to be true', () => {
    const e = explainEmptiness({ observations: 0, deliveredOrders: 0, riderCostsRecorded: 0, minSample: null });
    expect(e).toBeTruthy();
    expect(e!.has).toContain('0 observations');
    expect(e!.missing).toContain('no order has been delivered');
    expect(e!.missing).toContain('no minimum sample size is set');
    expect(e!.needs).toContain('one order completing');
  });

  it('goes quiet once there is something to say', () => {
    expect(explainEmptiness({ observations: 5, deliveredOrders: 5, riderCostsRecorded: 5, minSample: 3 })).toBeNull();
  });
});

/* ── The nightly run, against an in-memory repository ────────────────────── */

class FakeRepo implements ICalibrationRepository {
  observations: Observation[] = [];
  proposals: CalibrationProposal[] = [];
  factors: Array<{ kind: string; scopeKey: string; value: number; sampleSize: number; origin: string }> = [];
  milestoneFired = false;
  replaceCalls = 0;
  countsValue = { observations: 0, deliveredOrders: 0, riderCostsRecorded: 0, skippedMirrors: 0 };

  async allObservations() {
    return this.observations;
  }
  async counts() {
    return this.countsValue;
  }
  async scopes() {
    return {
      corridors: [...new Set(this.observations.map((o) => o.corridor).filter((v): v is string => Boolean(v)))],
      areas: [...new Set(this.observations.map((o) => o.areaSlug).filter((v): v is string => Boolean(v)))],
      hours: [],
    };
  }
  async currentFactor() {
    return null;
  }
  async replacePendingProposals(ps: any[]) {
    this.replaceCalls++;
    this.proposals = ps.map((p, i) => ({ ...p, id: `p-${i}`, createdAt: new Date(0) }));
    return ps.length;
  }
  async listProposals() {
    return this.proposals;
  }
  async findProposal(id: string) {
    return this.proposals.find((p) => p.id === id) ?? null;
  }
  async setProposalStatus(input: any) {
    const p = this.proposals.find((x) => x.id === input.id);
    if (p) p.status = input.status;
  }
  async writeFactor(input: any) {
    this.factors.push(input);
  }
  async areasWithMeasuredDistances() {
    return [];
  }
  async firstObservationAlertFired() {
    return this.milestoneFired;
  }
  async markFirstObservationAlertFired() {
    this.milestoneFired = true;
  }
  async firstObservation() {
    return this.countsValue.riderCostsRecorded > 0 ? { orderId: 'order-1', areaSlug: 'kampala-ntinda-10101', at: new Date(0) } : null;
  }
}

const audit = { entries: [] as any[], async save(e: any) { this.entries.push(e); return e; }, async list() { return []; }, async findByEntity() { return []; } };

let repo: FakeRepo;
let alerts: Array<{ orderId: string }>;

const run = (config: Record<string, number> = {}) =>
  new RunNightlyCalibrationUseCase(repo, audit as any, async () => config, () => 'B4', async (i) => {
    alerts.push({ orderId: i.orderId });
  });

beforeEach(() => {
  repo = new FakeRepo();
  audit.entries = [];
  alerts = [];
});

describe('the nightly run at zero observations', () => {
  it('proposes nothing and says why, rather than producing a blank screen', async () => {
    const r = await run().execute();
    expect(r.observations).toBe(0);
    expect(r.proposalsCreated).toBe(0);
    expect(r.emptiness).toBeTruthy();
    expect(r.emptiness!.missing).toContain('no order has been delivered');
    expect(r.firstObservationAlert).toBeNull();
  });

  it('proposes nothing even with plenty of data when the minimum is unset', async () => {
    repo.observations = Array.from({ length: 100 }, () => obs({ actualMinutes: 90 }));
    const r = await run({}).execute();
    expect(r.proposalsCreated).toBe(0);
    expect(r.outcomes.every((o) => o.outcome.kind === 'insufficient_data')).toBe(true);
  });

  it('proposes once there is a minimum AND enough data', async () => {
    repo.observations = Array.from({ length: 10 }, () => obs({ actualMinutes: 90, predictedMinutes: 60 }));
    const r = await run({ calibration_min_sample_size: 5 }).execute();
    expect(r.proposalsCreated).toBeGreaterThan(0);
    const corridor = repo.proposals.find((p) => p.factorKind === 'corridor_factor')!;
    expect(corridor.proposedValue).toBeCloseTo(1.5, 6);
    expect(corridor.sampleSize).toBe(10);
    // "Not learned" is carried explicitly, not implied by a 1.0.
    expect(corridor.currentState).toBe('not_learned');
    expect(corridor.currentValue).toBeNull();
    expect(corridor.status).toBe('pending');
  });
});

describe('rule 4 — stateless: running twice changes nothing', () => {
  it('produces identical proposals on a second run', async () => {
    repo.observations = Array.from({ length: 10 }, () => obs({ actualMinutes: 90, predictedMinutes: 60 }));
    const first = await run({ calibration_min_sample_size: 5 }).execute();
    const snapshot = JSON.stringify(repo.proposals.map(({ id, createdAt, ...rest }) => rest));
    const second = await run({ calibration_min_sample_size: 5 }).execute();
    expect(second.proposalsCreated).toBe(first.proposalsCreated);
    expect(JSON.stringify(repo.proposals.map(({ id, createdAt, ...rest }) => rest))).toBe(snapshot);
    // Replaced wholesale, so a bad night cannot accumulate beside a good one.
    expect(repo.replaceCalls).toBe(2);
  });

  it('never writes a factor — it PROPOSES', async () => {
    repo.observations = Array.from({ length: 10 }, () => obs({ actualMinutes: 90 }));
    await run({ calibration_min_sample_size: 5 }).execute();
    expect(repo.factors).toHaveLength(0);
  });
});

describe('the proposal queue REFUSES, it does not warn', () => {
  const accept = (config: Record<string, number>) =>
    new AcceptCalibrationProposalUseCase(repo, audit as any, async () => config);

  beforeEach(async () => {
    repo.observations = Array.from({ length: 10 }, () => obs({ actualMinutes: 90, predictedMinutes: 60 }));
    await run({ calibration_min_sample_size: 5 }).execute();
  });

  it('refuses acceptance below the minimum sample', async () => {
    repo.proposals[0].sampleSize = 2;
    const r = await accept({ calibration_min_sample_size: 5 }).execute({ proposalId: repo.proposals[0].id, actorId: 'ops' });
    expect(r).toMatchObject({ ok: false, code: 'BELOW_MINIMUM_SAMPLE' });
    expect(r.ok === false && r.message).toContain('2 deliveries');
    expect(repo.factors).toHaveLength(0);
  });

  it('refuses acceptance entirely when no minimum is configured', async () => {
    const r = await accept({}).execute({ proposalId: repo.proposals[0].id, actorId: 'ops' });
    expect(r).toMatchObject({ ok: false, code: 'MIN_SAMPLE_NOT_CONFIGURED' });
    expect(repo.factors).toHaveLength(0);
  });

  it('accepts above the minimum and records the fit as FITTED', async () => {
    const r = await accept({ calibration_min_sample_size: 5 }).execute({ proposalId: repo.proposals[0].id, actorId: 'ops' });
    expect(r.ok).toBe(true);
    expect(repo.factors[0]).toMatchObject({ origin: 'fitted', sampleSize: 10 });
  });

  it('records an EDITED value as human, never laundered as a fit', async () => {
    const r = await accept({ calibration_min_sample_size: 5 }).execute({
      proposalId: repo.proposals[0].id,
      actorId: 'ops',
      editedValue: 1.2,
    });
    expect(r.ok).toBe(true);
    // Nobody can forge a human-set value onto a model proposal, and nobody can
    // launder a hand-picked number as evidence.
    expect(repo.factors[0]).toMatchObject({ origin: 'human', value: 1.2 });
  });

  it('refuses a second decision on the same proposal', async () => {
    await accept({ calibration_min_sample_size: 5 }).execute({ proposalId: repo.proposals[0].id, actorId: 'ops' });
    const again = await accept({ calibration_min_sample_size: 5 }).execute({ proposalId: repo.proposals[0].id, actorId: 'ops' });
    expect(again).toMatchObject({ ok: false, code: 'ALREADY_DECIDED' });
  });
});

describe('the first-observation alert fires ONCE, ever', () => {
  it('does not fire while no rider cost exists', async () => {
    const r = await run().execute();
    expect(r.firstObservationAlert).toBeNull();
    expect(alerts).toHaveLength(0);
  });

  it('fires on the first recorded rider cost, and never again', async () => {
    repo.countsValue = { observations: 1, deliveredOrders: 1, riderCostsRecorded: 1, skippedMirrors: 0 };
    const first = await run().execute();
    expect(first.firstObservationAlert).toMatchObject({ fired: true, orderId: 'order-1' });
    expect(alerts).toHaveLength(1);
    expect(audit.entries.some((e) => e.action === 'DELIVERY_FIRST_OBSERVATION')).toBe(true);

    const second = await run().execute();
    expect(second.firstObservationAlert).toBeNull();
    expect(alerts).toHaveLength(1); // still one
  });
});
