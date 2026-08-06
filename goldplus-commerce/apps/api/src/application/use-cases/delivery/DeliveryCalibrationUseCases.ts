import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import {
  EmptyExplanation,
  FitOutcome,
  Observation,
  RebandFlag,
  explainEmptiness,
  fitDetourFactor,
  fitLastMileSplit,
  fitRatioFactor,
  fitWindowPercentiles,
  flagRebands,
} from '../../../domain/delivery/DeliveryCalibration';
import { FACTOR_PRIORS, FactorKind } from '../../../domain/delivery/DeliveryLearnedFactor';

/**
 * The nightly calibration (brief PART 4, stage D).
 *
 * PROPOSED, NEVER APPLIED. Every output lands in a queue with its sample size
 * and fee impact, and a human accepts, edits or rejects. A pricing model that
 * repoints itself overnight is one nobody can explain to a customer or an
 * accountant.
 *
 * STATELESS. Each run recomputes every factor from ALL observations, never
 * incrementally from the last run. Slower and self-correcting: a bad night
 * fixes itself and running twice changes nothing.
 *
 * NO SYNTHETIC DATA. This reads what is there. It never seeds, never
 * backfills, and there is no dev-only branch that writes an observation.
 */

export interface CalibrationProposal {
  id: string;
  factorKind: FactorKind;
  scopeKey: string;
  currentValue: number | null;
  currentState: 'not_learned' | 'fitted' | 'set_by_hand';
  proposedValue: number;
  sampleSize: number;
  /** What accepting this would do to a representative fee, in shillings. */
  feeImpactUgx: number | null;
  status: 'pending' | 'accepted' | 'rejected' | 'edited';
  createdAt: Date;
}

export interface ICalibrationRepository {
  /** ALL observations, always. Statelessness depends on this being complete. */
  allObservations(): Promise<Observation[]>;
  counts(): Promise<{ observations: number; deliveredOrders: number; riderCostsRecorded: number; skippedMirrors: number }>;
  /** Distinct corridors and areas seen in the capture table. */
  scopes(): Promise<{ corridors: string[]; areas: string[]; hours: number[] }>;
  currentFactor(kind: FactorKind, scopeKey: string): Promise<{ value: number; sampleSize: number; origin: string } | null>;
  replacePendingProposals(proposals: Array<Omit<CalibrationProposal, 'id' | 'createdAt'>>): Promise<number>;
  listProposals(status: string, limit: number): Promise<CalibrationProposal[]>;
  findProposal(id: string): Promise<CalibrationProposal | null>;
  setProposalStatus(input: { id: string; status: CalibrationProposal['status']; actorId: string }): Promise<void>;
  /** Applied ONLY through an accepted proposal, never by the job. */
  writeFactor(input: { kind: FactorKind; scopeKey: string; value: number; sampleSize: number; origin: 'fitted' | 'human'; actorId: string }): Promise<void>;
  areasWithMeasuredDistances(): Promise<Array<{ areaSlug: string; seededBand: string; measuredKm: number[] }>>;
  /** Has the first-observation alert already fired? One time only, ever. */
  firstObservationAlertFired(): Promise<boolean>;
  markFirstObservationAlertFired(input: { orderId: string; at: Date }): Promise<void>;
  firstObservation(): Promise<{ orderId: string; areaSlug: string | null; at: Date } | null>;
}

export interface CalibrationRunResult {
  observations: number;
  proposalsCreated: number;
  /** Per factor kind, why nothing was proposed when nothing was. */
  outcomes: Array<{ factorKind: FactorKind; scopeKey: string; outcome: FitOutcome }>;
  rebandFlags: RebandFlag[];
  /** Null when the reports have something to say. */
  emptiness: EmptyExplanation | null;
  firstObservationAlert: { fired: boolean; orderId: string | null } | null;
  windowPercentiles: { p10: number; p90: number; sampleSize: number } | null;
}

export class RunNightlyCalibrationUseCase {
  constructor(
    private readonly repo: ICalibrationRepository,
    private readonly audit: IAuditRepository,
    private readonly config: () => Promise<Record<string, number>>,
    private readonly bandFor: (km: number) => string | null,
    /** Fires once, ever, on the first real observation. */
    private readonly alert: ((input: { orderId: string; areaSlug: string | null }) => Promise<void>) | null,
  ) {}

  async execute(): Promise<CalibrationRunResult> {
    const [observations, counts, scopes, numeric] = await Promise.all([
      this.repo.allObservations(),
      this.repo.counts(),
      this.repo.scopes(),
      this.config(),
    ]);

    const minSample = Number.isFinite(numeric.calibration_min_sample_size)
      ? numeric.calibration_min_sample_size
      : null;

    const outcomes: CalibrationRunResult['outcomes'] = [];
    const proposals: Array<Omit<CalibrationProposal, 'id' | 'createdAt'>> = [];

    const consider = async (kind: FactorKind, scopeKey: string, outcome: FitOutcome) => {
      outcomes.push({ factorKind: kind, scopeKey, outcome });
      if (outcome.kind !== 'fitted') return;
      const current = await this.repo.currentFactor(kind, scopeKey);
      proposals.push({
        factorKind: kind,
        scopeKey,
        currentValue: current && current.origin !== 'prior' ? current.value : null,
        currentState: !current || current.origin === 'prior' ? 'not_learned' : current.origin === 'human' ? 'set_by_hand' : 'fitted',
        proposedValue: outcome.factor.value,
        sampleSize: outcome.sampleSize,
        // Fee impact needs a representative fee to move; with no launch values
        // set there is nothing to move, and NULL says so rather than showing 0.
        feeImpactUgx: null,
        status: 'pending',
      });
    };

    for (const corridor of scopes.corridors) {
      const obs = observations.filter((o) => o.corridor === corridor);
      await consider('corridor_factor', corridor, fitRatioFactor({ observations: obs, minSample, prior: FACTOR_PRIORS.corridor_factor }));
      await consider('detour_factor', corridor, fitDetourFactor({ observations: obs, minSample }));
    }
    for (const hour of scopes.hours) {
      const obs = observations.filter((o) => o.eatHourOfWeek === hour);
      await consider('hour_factor', String(hour), fitRatioFactor({ observations: obs, minSample, prior: FACTOR_PRIORS.hour_factor }));
    }
    for (const areaSlug of scopes.areas) {
      const obs = observations.filter((o) => o.areaSlug === areaSlug);
      const split = fitLastMileSplit({ observations: obs, minSample });
      // The WITHOUT-pin side is the one the model uses as its baseline; the
      // difference between the two is what would justify a pin time claim, and
      // it stays null until both halves have a sample.
      await consider('last_mile_minutes', areaSlug, split.withoutPin);
    }

    // Stateless: pending proposals are REPLACED wholesale, so running twice
    // changes nothing and a bad night's output cannot accumulate.
    const created = await this.repo.replacePendingProposals(proposals);

    const rebandFlags = flagRebands({
      areas: await this.repo.areasWithMeasuredDistances(),
      bandFor: this.bandFor,
      minSample,
    });

    const windowPercentiles = fitWindowPercentiles({
      observations,
      minSample: Number.isFinite(numeric.window_min_sample_size) ? numeric.window_min_sample_size : null,
      lowPct: 10,
      highPct: 90,
    });

    // The first real observation. One alert, ever. The day an order completes
    // with a recorded rider cost is the day this module stops being
    // theoretical, and nobody should learn that from a weekly report.
    let firstObservationAlert: CalibrationRunResult['firstObservationAlert'] = null;
    if (counts.riderCostsRecorded > 0 && !(await this.repo.firstObservationAlertFired())) {
      const first = await this.repo.firstObservation();
      if (first) {
        if (this.alert) await this.alert({ orderId: first.orderId, areaSlug: first.areaSlug }).catch(() => undefined);
        await this.repo.markFirstObservationAlertFired({ orderId: first.orderId, at: new Date() });
        await new CreateAuditLogUseCase(this.audit).execute({
          actorId: null,
          action: 'DELIVERY_FIRST_OBSERVATION',
          entity: 'delivery_quote_capture',
          entityId: first.orderId,
          previousState: null,
          newState: {
            message: 'The delivery model has its first real observation. It is no longer theoretical.',
            orderId: first.orderId,
            areaSlug: first.areaSlug,
          },
        });
        firstObservationAlert = { fired: true, orderId: first.orderId };
      }
    }

    return {
      observations: observations.length,
      proposalsCreated: created,
      outcomes,
      rebandFlags,
      emptiness: explainEmptiness({ ...counts, minSample }),
      firstObservationAlert,
      windowPercentiles,
    };
  }
}

/**
 * Accept a proposal.
 *
 * REFUSES below the minimum sample rather than warning about it — an operator
 * should not have to notice a sample size of two. And it refuses entirely when
 * no minimum is configured, because "below the minimum" is unanswerable then.
 */
export class AcceptCalibrationProposalUseCase {
  constructor(
    private readonly repo: ICalibrationRepository,
    private readonly audit: IAuditRepository,
    private readonly config: () => Promise<Record<string, number>>,
  ) {}

  async execute(input: { proposalId: string; actorId: string; editedValue?: number | null }) {
    const proposal = await this.repo.findProposal(input.proposalId);
    if (!proposal) return { ok: false as const, code: 'PROPOSAL_NOT_FOUND', message: 'That proposal does not exist.' };
    if (proposal.status !== 'pending') {
      return { ok: false as const, code: 'ALREADY_DECIDED', message: 'That proposal has already been decided.' };
    }
    const numeric = await this.config();
    const minSample = Number.isFinite(numeric.calibration_min_sample_size) ? numeric.calibration_min_sample_size : null;
    if (minSample === null) {
      return {
        ok: false as const,
        code: 'MIN_SAMPLE_NOT_CONFIGURED',
        message: 'No minimum sample size is set, so it cannot be judged whether this proposal rests on enough deliveries.',
      };
    }
    if (proposal.sampleSize < minSample) {
      return {
        ok: false as const,
        code: 'BELOW_MINIMUM_SAMPLE',
        message: `This rests on ${proposal.sampleSize} deliveries and the minimum is ${minSample}. It cannot be accepted.`,
      };
    }

    const value = input.editedValue ?? proposal.proposedValue;
    if (!Number.isFinite(value)) {
      return { ok: false as const, code: 'INVALID_VALUE', message: 'That is not a usable number.' };
    }
    const edited = input.editedValue !== undefined && input.editedValue !== null && input.editedValue !== proposal.proposedValue;

    await this.repo.writeFactor({
      kind: proposal.factorKind,
      scopeKey: proposal.scopeKey,
      value,
      sampleSize: proposal.sampleSize,
      // An EDITED value is a human's number carrying a human's authority. It
      // must never be recorded as fitted — nobody can forge a human-set value
      // onto a model proposal, and nobody can launder a hand-picked one as a fit.
      origin: edited ? 'human' : 'fitted',
      actorId: input.actorId,
    });
    await this.repo.setProposalStatus({ id: input.proposalId, status: edited ? 'edited' : 'accepted', actorId: input.actorId });
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'DELIVERY_CALIBRATION_ACCEPTED',
      entity: 'delivery_learned_factor',
      entityId: `${proposal.factorKind}:${proposal.scopeKey}`,
      previousState: { value: proposal.currentValue, state: proposal.currentState },
      newState: { value, sampleSize: proposal.sampleSize, origin: edited ? 'human' : 'fitted', proposalId: proposal.id },
    });
    return { ok: true as const };
  }
}

export class RejectCalibrationProposalUseCase {
  constructor(
    private readonly repo: ICalibrationRepository,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: { proposalId: string; actorId: string; reason: string }) {
    const proposal = await this.repo.findProposal(input.proposalId);
    if (!proposal) return { ok: false as const, code: 'PROPOSAL_NOT_FOUND', message: 'That proposal does not exist.' };
    if (!input.reason || input.reason.trim().length < 3) {
      return { ok: false as const, code: 'REASON_REQUIRED', message: 'A rejection needs a reason.' };
    }
    await this.repo.setProposalStatus({ id: input.proposalId, status: 'rejected', actorId: input.actorId });
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'DELIVERY_CALIBRATION_REJECTED',
      entity: 'delivery_learned_factor',
      entityId: `${proposal.factorKind}:${proposal.scopeKey}`,
      previousState: { proposedValue: proposal.proposedValue, sampleSize: proposal.sampleSize },
      newState: { rejected: true, reason: input.reason.trim() },
    });
    return { ok: true as const };
  }
}
