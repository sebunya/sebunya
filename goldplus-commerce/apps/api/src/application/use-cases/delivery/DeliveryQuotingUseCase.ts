import {
  ADDITIVE_NEUTRAL_FACTOR,
  DistanceBand,
  NEUTRAL_FACTOR,
  QuoteInputs,
  isDistanceBand,
} from '../../../domain/delivery/DeliveryModel';
import { LearnedFactorState } from '../../../domain/delivery/DeliveryLearnedFactor';
import { resolveFulfilmentMode } from '../../../domain/delivery/DeliveryFulfilmentMode';
import { FulfilmentQuote, quoteFulfilment } from '../../../domain/delivery/DeliveryQuoteService';
import { BusRateCard, ParcelOffice } from '../../../domain/delivery/DeliveryBusRateCard';
import { BasketLine, capacitiesFromConfig, planParcels } from '../../../domain/delivery/DeliveryParcelClass';
import { minOrderValuesFromConfig } from '../../../domain/delivery/DeliveryProportionality';
import { toEatParts } from '@goldplus/shared';
import { AreaInput } from '../../../domain/delivery/DeliveryModel';

/**
 * The resolver PORT, declared here rather than imported from infrastructure —
 * the application layer owns the shape it needs and the adapter implements it.
 * Caught by the boundaries test, which is exactly its job.
 */
export interface ResolvedArea {
  input: AreaInput;
  label: string;
  via: 'area_slug' | 'alias' | 'exact' | 'trigram' | 'district_only' | 'cross_district_correction' | null;
  aliasUsed: string | null;
}

export interface IAreaResolverPort {
  forOrderLocation(input: {
    areaSlug?: string | null;
    deliveryArea?: string | null;
    district?: string | null;
  }): Promise<ResolvedArea | null>;
}

/**
 * THE quoting service, at the application layer (contract #1).
 *
 * One thing answers "what does delivery cost". It resolves the address, decides
 * the fulfilment mode, reads the live configuration and learned factors, plans
 * the parcels, and returns one quote. Everything below it — the minutes model,
 * the rate card, the proportionality rules — is its internals.
 *
 * THE FALLBACK. If and only if the answer is CONFIG_INCOMPLETE, the caller may
 * use the legacy path for that request. Every other reason is a CORRECT answer
 * and is returned as-is: an unserviceable area is not a gap to paper over.
 *
 * This is not shadow mode. There is no comparison and nothing to reconcile. It
 * exists so that cutting over before the launch values are set does not drop
 * customer-visible coverage from 39% to zero. It goes cold the moment the
 * wizard is run, and the deletion of the legacy paths is the module's finish
 * line.
 */

export interface IDeliveryQuotingRepository {
  /** Learned factors for this destination, or priors when nothing is learned. */
  factorsFor(input: { areaSlug: string | null; corridor: string | null; eatHourOfWeek: number | null }): Promise<{
    corridor: LearnedFactorState;
    hour: LearnedFactorState;
    detour: LearnedFactorState;
    lastMile: LearnedFactorState;
    areaSampleSize: number;
    observedMinutes: { p10: number; p90: number } | null;
  }>;
  cardsFor(input: { town: string; district: string }): Promise<BusRateCard[]>;
  officeFor(input: { town: string; district: string }): Promise<ParcelOffice | null>;
  /** Shipping class per product, plus its category default. */
  shippingClassesFor(productIds: readonly string[]): Promise<
    Map<
      string,
      { productShippingClass: string | null; categoryShippingClass: string | null; productName: string; priceUgx: number }
    >
  >;
  hasActiveOrigin(): Promise<boolean>;
  activeOriginCode(): Promise<string | null>;
}

export interface QuoteRequest {
  areaSlug?: string | null;
  deliveryArea?: string | null;
  district?: string | null;
  items: ReadonlyArray<{ productId: string; quantity: number }>;
  /**
   * Merchandise subtotal. OPTIONAL because checkout needs the fee before it has
   * priced the basket — when absent it is computed from the same product read
   * the shipping classes come from, so no extra query and no guessed value.
   */
  subtotalUgx?: number;
  /** For the hour factor and the cutoff. Defaults to now. */
  at?: Date;
  hasPin?: boolean;
}

export type QuoteOutcome = {
  quote: FulfilmentQuote;
  resolved: ResolvedArea | null;
  /** Which mechanism answered, recorded on the capture row. */
  pricedBy: 'delivery_model' | 'bus_rate_card' | 'manual';
  /** True only for CONFIG_INCOMPLETE. The caller may then use the legacy path. */
  mayFallBackToLegacy: boolean;
};

export class DeliveryQuotingUseCase {
  constructor(
    private readonly repo: IDeliveryQuotingRepository,
    private readonly resolver: IAreaResolverPort,
    private readonly config: {
      currentValues(): Promise<Record<string, string>>;
      numericValues(): Promise<Record<string, number>>;
      publishedVersionId(): Promise<string | null>;
    },
  ) {}

  async execute(request: QuoteRequest): Promise<QuoteOutcome> {
    const at = request.at ?? new Date();
    const [raw, numeric, versionId, resolved] = await Promise.all([
      this.config.currentValues(),
      this.config.numericValues(),
      this.config.publishedVersionId(),
      this.resolver.forOrderLocation({
        areaSlug: request.areaSlug ?? null,
        deliveryArea: request.deliveryArea ?? null,
        district: request.district ?? null,
      }),
    ]);

    const rawCeiling = raw.own_rider_max_band ?? null;
    const ceiling: DistanceBand | null = rawCeiling && isDistanceBand(rawCeiling) ? (rawCeiling as DistanceBand) : null;
    const mode = resolved ? resolveFulfilmentMode({ ...resolved.input, declaredMode: null }, ceiling) : null;

    // Hour of week in EAT, never the server's timezone.
    const parts = toEatParts(at);
    const eatHourOfWeek = parts.weekday * 24 + parts.hour;

    const [factors, origin, originCode] = await Promise.all([
      this.repo.factorsFor({
        areaSlug: resolved?.input.areaSlug ?? null,
        corridor: resolved?.input.corridor ?? null,
        eatHourOfWeek,
      }),
      this.repo.hasActiveOrigin(),
      this.repo.activeOriginCode(),
    ]);

    // Parcels are only planned for the bus path, but planning them costs one
    // query and makes the explanation complete either way.
    const town = resolved?.input.district ?? request.district ?? null;
    const [classes, cards, office] = await Promise.all([
      this.repo.shippingClassesFor(request.items.map((i) => i.productId)),
      mode === 'bus_parcel' && town ? this.repo.cardsFor({ town, district: town }) : Promise.resolve([]),
      mode === 'bus_parcel' && town ? this.repo.officeFor({ town, district: town }) : Promise.resolve(null),
    ]);

    const lines: BasketLine[] = request.items.map((i) => {
      const c = classes.get(i.productId);
      return {
        productId: i.productId,
        quantity: i.quantity,
        productShippingClass: c?.productShippingClass ?? null,
        categoryShippingClass: c?.categoryShippingClass ?? null,
        productName: c?.productName,
      };
    });
    const parcels = planParcels(lines, capacitiesFromConfig(numeric));

    // The threshold and proportionality rules need a subtotal. Deriving it from
    // the product read already in hand keeps the quote self-contained and never
    // substitutes a placeholder for a real basket value.
    const subtotalUgx =
      request.subtotalUgx !== undefined && Number.isFinite(request.subtotalUgx)
        ? request.subtotalUgx
        : request.items.reduce((n, i) => n + (classes.get(i.productId)?.priceUgx ?? 0) * i.quantity, 0);

    const rider: Omit<QuoteInputs, 'area'> = {
      config: numeric,
      hasActiveOrigin: origin,
      originCode,
      corridorFactor: factors.corridor,
      hourFactor: factors.hour,
      detourFactor: factors.detour,
      lastMileMinutes: factors.lastMile,
      areaSampleSize: factors.areaSampleSize,
      observedMinutes: factors.observedMinutes,
      onTimeTargetBps: numeric.on_time_target_bps ?? null,
      windowMinSampleSize: numeric.window_min_sample_size ?? null,
      configVersionId: versionId,
    };

    const quote = quoteFulfilment({
      area: resolved?.input ?? null,
      mode,
      rider,
      bus: {
        cards,
        office,
        parcels,
        destinationTown: town,
        destinationDistrict: town,
        at,
        declaredValueUgx: subtotalUgx || null,
      },
      subtotalUgx,
      proportionality: {
        feeToValueRatioCeiling: numeric.fee_to_value_ratio_ceiling ?? null,
        minOrderValueUgx: minOrderValuesFromConfig(numeric),
        freeDeliveryThresholdUgx: numeric.free_delivery_threshold_ugx ?? null,
      },
    });

    return {
      quote,
      resolved,
      pricedBy: quote.kind === 'rider_delivery' ? 'delivery_model' : quote.kind === 'bus_shipment' ? 'bus_rate_card' : 'manual',
      // ONLY config-incomplete. Every other reason is a correct answer, and
      // handing a correct answer to the legacy path would replace it with a
      // wrong one — the legacy model would happily price a lake island.
      mayFallBackToLegacy: quote.kind === 'unavailable' && quote.reason === 'CONFIG_INCOMPLETE',
    };
  }
}

/** Neutral factors, for callers that have no destination yet (product page). */
export const NEUTRAL_FACTOR_SET = {
  corridor: NEUTRAL_FACTOR,
  hour: NEUTRAL_FACTOR,
  detour: NEUTRAL_FACTOR,
  lastMile: ADDITIVE_NEUTRAL_FACTOR,
  areaSampleSize: 0,
  observedMinutes: null,
} as const;
