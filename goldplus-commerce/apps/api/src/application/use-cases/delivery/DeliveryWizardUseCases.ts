import {
  DEFAULT_PLAUSIBLE_SPEED_MAX_KMH,
  DEFAULT_PLAUSIBLE_SPEED_MIN_KMH,
  DerivedValue,
  PlausibilityWarning,
  WizardAnswers,
  deriveLaunchValues,
} from '../../../domain/delivery/DeliveryLaunchWizard';
import { DistanceBand, isDistanceBand } from '../../../domain/delivery/DeliveryModel';
import { DraftConfigVersionUseCase, IDeliveryConfigRepository } from './DeliveryConfigUseCases';

/**
 * The launch wizard's application layer (brief "FINISH", PART 2).
 *
 * The wizard is an INPUT SURFACE, NOT A BYPASS. It derives values and then
 * hands them to exactly the same draft → preview → publish path a manual edit
 * uses, so a wizard publish is versioned, attributed and revertible like any
 * other. Nothing here writes a config value directly.
 */

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

export interface IWizardAreaReader {
  /** Alias-aware search restricted to areas that actually carry a band. */
  searchQuotableAreas(query: string, limit: number): Promise<Array<{ areaSlug: string; label: string; band: DistanceBand; corridor: string; district: string }>>;
  bandFor(areaSlug: string): Promise<{ label: string; band: DistanceBand; corridor: string; district: string } | null>;
}

export interface WizardDerivationResult {
  derived: DerivedValue[];
  warnings: PlausibilityWarning[];
  values: Record<string, number>;
  roundTripKm: number;
  areaLabel: string;
  band: DistanceBand;
}

/**
 * Ask about a delivery they already make, and derive the launch values.
 *
 * Never defaults. If an answer is missing or unusable the derivation refuses
 * and names the answer, which is the hard stop the brief sets: a launch value
 * that would have to be defaulted rather than derived means stopping, not
 * guessing.
 */
export class DeriveLaunchValuesUseCase {
  constructor(
    private readonly areas: IWizardAreaReader,
    private readonly currentValues: () => Promise<Record<string, string>>,
  ) {}

  async execute(input: {
    areaSlug: string;
    roundTripMinutes: number;
    riderPayUgx: number;
    handlingMinutes: number;
    marginPercent: number;
    minimumFeeUgx: number;
    freeDeliveryThresholdUgx: number | null;
  }): Promise<{ ok: true; result: WizardDerivationResult } | Fail> {
    const area = await this.areas.bandFor(input.areaSlug);
    if (!area) {
      return fail(
        'AREA_NOT_QUOTABLE',
        'That place is not in the metro area set, so it has no distance band and cannot anchor the calculation. Pick somewhere inside Greater Kampala that you deliver to often.',
      );
    }

    // The warning bounds are configuration like everything else, so an operator
    // who finds them wrong for their city can move them.
    const live = await this.currentValues();
    const bound = (key: string, fallback: number): number => {
      const n = Number(live[key]);
      return Number.isFinite(n) ? n : fallback;
    };

    const answers: WizardAnswers = {
      areaSlug: input.areaSlug,
      areaLabel: area.label,
      band: area.band,
      roundTripMinutes: input.roundTripMinutes,
      riderPayUgx: input.riderPayUgx,
      handlingMinutes: input.handlingMinutes,
      marginPercent: input.marginPercent,
      minimumFeeUgx: input.minimumFeeUgx,
      freeDeliveryThresholdUgx: input.freeDeliveryThresholdUgx,
    };

    const derivation = deriveLaunchValues(answers, {
      minKmh: bound('plausible_speed_min_kmh', DEFAULT_PLAUSIBLE_SPEED_MIN_KMH),
      maxKmh: bound('plausible_speed_max_kmh', DEFAULT_PLAUSIBLE_SPEED_MAX_KMH),
    });
    if (!derivation.ok) return fail(derivation.refusal, derivation.message);

    return {
      ok: true,
      result: {
        derived: derivation.derived,
        warnings: derivation.warnings,
        values: derivation.values,
        roundTripKm: derivation.roundTripKm,
        areaLabel: area.label,
        band: area.band,
      },
    };
  }
}

/**
 * Turn a derivation into a draft, ready for the mandatory preview.
 *
 * Expert mode enters the same five (or six) numbers directly and lands in the
 * same place — same draft, same preview, same confirmation. There is one
 * publish path and the wizard does not get a private one.
 */
export class DraftLaunchValuesUseCase {
  constructor(
    private readonly drafts: DraftConfigVersionUseCase,
    private readonly repo: IDeliveryConfigRepository,
  ) {}

  async execute(input: {
    values: Record<string, number>;
    actorId: string;
    /** How these numbers were arrived at, recorded on the version. */
    reason: string;
  }): Promise<{ ok: true; versionId: string } | Fail> {
    const asStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.values)) {
      if (!Number.isFinite(v)) return fail('NON_FINITE_VALUE', `${k} did not come out as a usable number.`);
      // UGX values are whole shillings; ratios and speeds keep four decimals so
      // a derived 18.666… km/h is not silently rounded into a different fee.
      asStrings[k] = k.endsWith('_ugx') || k === 'handling_minutes' ? String(Math.round(v)) : String(Number(v.toFixed(4)));
    }
    const drafted = await this.drafts.execute({
      values: asStrings,
      reason: input.reason,
      actorId: input.actorId,
      origin: 'human',
    });
    if (!drafted.ok) return fail(drafted.code, drafted.message);
    // Read back so a caller cannot assume what was stored.
    await this.repo.valuesForVersion(drafted.version.id);
    return { ok: true, versionId: drafted.version.id };
  }
}

/** Narrow a raw band string from a request without trusting it. */
export function asBand(value: string): DistanceBand | null {
  return isDistanceBand(value) ? (value as DistanceBand) : null;
}
