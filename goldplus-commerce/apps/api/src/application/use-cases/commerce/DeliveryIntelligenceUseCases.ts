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
  /**
   * THE quoting service (docs/delivery/CONTRACT.md, guarantee #1), through the
   * same narrow adapter checkout holds. Optional only so the cockpit use case,
   * which shares these deps, still constructs without it.
   */
  quoting?: {
    quote(input: {
      district?: string | null;
      deliveryArea?: string | null;
      items: ReadonlyArray<{ productId: string; quantity: number }>;
    }): Promise<{ feeUgx: number | null; confirmed: boolean; mayFallBackToLegacy: boolean }>;
  } | null;
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

    // THE quoting service answers first, under exactly the rule CheckoutUseCase
    // applies: the legacy zone/band model is consulted only on CONFIG_INCOMPLETE.
    //
    // This endpoint drives the checkout page's "Delivery" row and its grand
    // total, and it answered from the legacy model alone while the order was
    // charged the quoting service's fee. Gulu was the concrete case: an enabled
    // zone row said 15,000, so the totals showed goods + 15,000, while the
    // service resolved it to a bus parcel with no rate card and the order was
    // created with fee 0, unconfirmed. Two quoting paths, two answers, one page.
    // The customer saw a total the order did not charge.
    if (this.deps.quoting) {
      const quoted = await this.deps.quoting.quote({ district, deliveryArea: area, items: [] });
      if (!quoted.mayFallBackToLegacy) {
        const estimate: DeliveryEstimate = quoted.feeUgx === null
          ? { kind: 'UNAVAILABLE', feeUgx: null, source: null, band: null, km: null, sampleSize: 0, observedDisagreesWithModel: false }
          : { kind: quoted.confirmed ? 'CONFIRMED' : 'ESTIMATED', feeUgx: quoted.feeUgx, source: 'MODEL', band: null, km: null, sampleSize: 0, observedDisagreesWithModel: false };
        return { ok: true, district, area, estimate };
      }
    }

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
