import {
  UGANDA_DISTRICTS,
  normalizeUgandaDistrict,
  districtRoadKm,
  deliveryPointKm,
} from '@goldplus/shared';
import {
  DEFAULT_DELIVERY_BAND_POLICY,
  DeliveryBandPolicy,
  DeliveryEstimate,
  bandForKm,
  bandFeeUgx,
  estimateDeliveryFee,
  validateBandPolicy,
} from '../../../domain/commerce/DeliveryFeePrediction';
import { normalizeDistrict } from '../../../domain/commerce/DeliveryFee';
import { IDeliveryZoneRepository } from '../../ports/IDeliveryZoneRepository';
import {
  IDeliveryFeeObservationReader,
  IDeliveryPricingPolicyRepository,
  StoredDeliveryBandPolicy,
} from '../../ports/IDeliveryIntelligence';

interface Deps {
  zones: IDeliveryZoneRepository;
  policy: IDeliveryPricingPolicyRepository;
  observations: IDeliveryFeeObservationReader;
}

async function effectivePolicy(repo: IDeliveryPricingPolicyRepository): Promise<DeliveryBandPolicy> {
  // Never saved → the seed defaults apply, so the cockpit and the estimate
  // line work from day one; the first save replaces them with owned numbers.
  return (await repo.get()) ?? DEFAULT_DELIVERY_BAND_POLICY;
}

/** One destination's estimate — the checkout read. */
export class GetDeliveryEstimateUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: { district: string; area?: string | null }): Promise<
    | { ok: true; district: string; area: string | null; estimate: DeliveryEstimate }
    | { ok: false; code: 'UNKNOWN_DISTRICT'; message: string }
  > {
    const district = normalizeUgandaDistrict(input.district);
    if (!district) {
      return { ok: false, code: 'UNKNOWN_DISTRICT', message: `"${input.district}" is not a Uganda district.` };
    }
    const area = input.area?.trim() || null;
    const [policy, zone, observed] = await Promise.all([
      effectivePolicy(this.deps.policy),
      this.deps.zones.findByDistrict(district),
      this.deps.observations.summarizeByDistrict(),
    ]);
    const estimate = estimateDeliveryFee({
      policy,
      km: deliveryPointKm(district, area),
      zoneFeeUgx: zone && zone.enabled ? zone.feeUgx : null,
      observation: observed.get(normalizeDistrict(district)) ?? null,
    });
    return { ok: true, district, area, estimate };
  }
}

export interface DistrictIntelligenceRow {
  district: string;
  km: number | null;
  band: string | null;
  modelFeeUgx: number | null;
  observedMedianUgx: number | null;
  observedCount: number;
  zoneFeeUgx: number | null;
  zoneEnabled: boolean | null;
  effective: DeliveryEstimate;
}

/** The operator's cockpit: every district, model vs observed vs promised. */
export class GetDeliveryIntelligenceUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<{
    policy: DeliveryBandPolicy & { note?: string | null; stored: boolean };
    rows: DistrictIntelligenceRow[];
  }> {
    const [stored, zones, observed] = await Promise.all([
      this.deps.policy.get(),
      this.deps.zones.list(),
      this.deps.observations.summarizeByDistrict(),
    ]);
    const policy = stored ?? DEFAULT_DELIVERY_BAND_POLICY;
    const zoneByDistrict = new Map(zones.map((z) => [normalizeDistrict(z.district), z]));

    const rows = UGANDA_DISTRICTS.map((district) => {
      const km = districtRoadKm(district);
      const band = km !== null ? bandForKm(km) : null;
      const zone = zoneByDistrict.get(normalizeDistrict(district)) ?? null;
      const obs = observed.get(normalizeDistrict(district)) ?? null;
      const effective = estimateDeliveryFee({
        policy,
        km,
        zoneFeeUgx: zone && zone.enabled ? zone.feeUgx : null,
        observation: obs,
      });
      return {
        district,
        km,
        band,
        modelFeeUgx: band !== null ? bandFeeUgx(policy, band) : null,
        observedMedianUgx: obs?.medianFeeUgx ?? null,
        observedCount: obs?.sampleSize ?? 0,
        zoneFeeUgx: zone?.feeUgx ?? null,
        zoneEnabled: zone?.enabled ?? null,
        effective,
      };
    });

    return {
      policy: { ...policy, note: stored?.note ?? null, stored: Boolean(stored) },
      rows,
    };
  }
}

export class SaveDeliveryPricingPolicyUseCase {
  constructor(private readonly policyRepo: IDeliveryPricingPolicyRepository) {}

  async execute(input: {
    policy: Partial<DeliveryBandPolicy>;
    note?: string | null;
    actorId: string | null;
  }): Promise<
    | { ok: true; policy: StoredDeliveryBandPolicy }
    | { ok: false; code: 'BAD_INPUT'; message: string }
  > {
    const problem = validateBandPolicy(input.policy);
    if (problem) return { ok: false, code: 'BAD_INPUT', message: problem };
    const note = input.note?.toString().trim().slice(0, 300) || null;
    const saved = await this.policyRepo.save(input.policy as DeliveryBandPolicy, {
      note,
      actorId: input.actorId,
    });
    return { ok: true, policy: saved };
  }
}
