import {
  ADDITIVE_NEUTRAL_FACTOR,
  DistanceBand,
  NEUTRAL_FACTOR,
  QuoteInputs,
  isDistanceBand,
} from '../../../domain/delivery/DeliveryModel';
import { parseFeeLadder, type FeeShape } from '../../../domain/delivery/DeliveryFeeLadder';
import { LearnedFactorState } from '../../../domain/delivery/DeliveryLearnedFactor';
import { resolveFulfilmentMode } from '../../../domain/delivery/DeliveryFulfilmentMode';
import { FulfilmentQuote, applyFreeDeliveryThreshold, quoteFulfilment } from '../../../domain/delivery/DeliveryQuoteService';
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
  via: 'area_slug' | 'alias' | 'exact' | 'trigram' | 'district_only' | 'cross_district_correction' | 'pin' | null;
  aliasUsed: string | null;
}

export interface IAreaResolverPort {
  forOrderLocation(input: {
    areaSlug?: string | null;
    deliveryArea?: string | null;
    district?: string | null;
    /** 0190: a pin with no area named (a WhatsApp location, a map link): the nearest area point, when it is close and unambiguous. */
    point?: { lat: number; lng: number } | null;
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
    /** Last-mile minutes learned for orders WITHOUT a pin: the model's baseline. */
    lastMile: LearnedFactorState;
    /** §4.6: last-mile minutes learned for this area's orders WITH a pin (scope `<area>#pin`); prior until learned. */
    lastMileWithPin?: LearnedFactorState;
    areaSampleSize: number;
    observedMinutes: { p10: number; p90: number } | null;
  }>;
  /**
   * The free-delivery threshold set on this area's zone, when that zone is
   * ACTIVE and carries one. Null means the zone says nothing and the shop-wide
   * value applies. The operator could set this per zone and quoting never read
   * it, so the figure sat in the database changing nothing.
   */
  zoneFreeDeliveryThresholdUgx(areaSlug: string): Promise<number | null>;
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
  /** 0190: the customer's pin, when they gave one. Resolves the area when none was named; sets the PIN tier. */
  point?: { lat: number; lng: number } | null;
  /** The ladder dry run only: price as if these were the published fee_shape / fee_ladder. Never from a public route. */
  feeShapeOverride?: FeeShape | null;
  feeLadderOverride?: readonly number[] | null;
}

export type QuoteOutcome = {
  quote: FulfilmentQuote;
  resolved: ResolvedArea | null;
  /** Which mechanism answered, recorded on the capture row. */
  pricedBy: 'delivery_model' | 'bus_rate_card' | 'manual';
  /** True only for CONFIG_INCOMPLETE. The caller may then use the legacy path. */
  mayFallBackToLegacy: boolean;
  /**
   * The free-delivery threshold that governs this destination (the zone's own
   * when its policy is active, else the shop-wide one), or null when the
   * mechanic is off. Returned so every surface shows progress against the SAME
   * figure the waiver was decided on, and so checkout can re-decide it on the
   * post-promotion goods total it only learns after pricing.
   */
  freeDeliveryThresholdUgx: number | null;
  /** The basis the waiver (if any) was decided on. */
  thresholdBasisUgx: number;
  /**
   * §4.6: how much less this quote would be with a pin, when the area has
   * learned last-mile minutes on both sides and the difference moves the fee by
   * at least one rounding step. Null otherwise, and then no nudge is shown.
   */
  pinSavingUgx: number | null;
};

/**
 * 0189: the resolver reports the area's point distance as a fact on every
 * quote (`centroidKm`); the registry's `distance_source` decides whether the
 * model may PRICE with it. Anything but 'measured' leaves `measuredKm` null,
 * so loading the points changes no fee until an operator flips the key.
 */
export function withMeasuredDistance(area: AreaInput, distanceSource: string | null): AreaInput {
  const km = area.centroidKm;
  const usable = distanceSource === 'measured' && typeof km === 'number' && Number.isFinite(km) && km >= 0;
  return { ...area, measuredKm: usable ? km : null };
}

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
        point: request.point ?? null,
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
    //
    // A carrier's card names a TOWN and its district ("Fort Portal, Kabarole"). The town used to be the district
    // for both, so a card for any town not named after its district never matched (NO_RATE_CARD forever). The
    // resolved area's own name is tried first, then the district's town, which is what every card that worked
    // before ("Gulu, Gulu") still matches.
    const destinationDistrict = resolved?.input.district ?? request.district ?? null;
    const areaTown = resolved && !resolved.input.districtOnly ? (resolved.label.split(',')[0] ?? '').trim() || null : null;
    let town = destinationDistrict;
    let cards: Awaited<ReturnType<IDeliveryQuotingRepository['cardsFor']>> = [];
    const classesRead = this.repo.shippingClassesFor(request.items.map((i) => i.productId));
    if (mode === 'bus_parcel' && destinationDistrict) {
      for (const candidate of [...new Set([areaTown, destinationDistrict].filter((t): t is string => !!t))]) {
        const found = await this.repo.cardsFor({ town: candidate, district: destinationDistrict });
        if (found.some((c) => c.destinationDistrict.trim().toLowerCase() === destinationDistrict.trim().toLowerCase())) {
          town = candidate;
          cards = found;
          break;
        }
      }
    }
    const [classes, office] = await Promise.all([
      classesRead,
      mode === 'bus_parcel' && town && destinationDistrict ? this.repo.officeFor({ town, district: destinationDistrict }) : Promise.resolve(null),
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

    const hasPin = request.hasPin === true || !!request.point;
    const withPin = factors.lastMileWithPin ?? null;
    const feeShape: FeeShape = (request.feeShapeOverride ?? raw.fee_shape) === 'ladder' ? 'ladder' : 'continuous';
    const feeLadder = request.feeLadderOverride !== undefined ? request.feeLadderOverride : parseFeeLadder(raw.fee_ladder);
    const rider: Omit<QuoteInputs, 'area'> = {
      config: numeric,
      hasActiveOrigin: origin,
      originCode,
      hasPin,
      corridorFactor: factors.corridor,
      hourFactor: factors.hour,
      detourFactor: factors.detour,
      // §4.6: a pinned order is priced with the minutes pinned orders in this area actually took, once learned.
      lastMileMinutes: hasPin && withPin && withPin.kind !== 'prior' ? withPin : factors.lastMile,
      feeShape,
      feeLadder,
      areaSampleSize: factors.areaSampleSize,
      observedMinutes: factors.observedMinutes,
      onTimeTargetBps: numeric.on_time_target_bps ?? null,
      windowMinSampleSize: numeric.window_min_sample_size ?? null,
      configVersionId: versionId,
    };

    const zoneFreeDeliveryThreshold = resolved?.input.areaSlug
      ? await this.repo.zoneFreeDeliveryThresholdUgx(resolved.input.areaSlug)
      : null;

    const freeDeliveryThresholdUgx = zoneFreeDeliveryThreshold ?? numeric.free_delivery_threshold_ugx ?? null;
    // 0189: the area's point distance is a fact the resolver carries on every
    // quote; whether the model PRICES with it is the registry's decision. Off
    // by default, so loading and checking the points moves no fee.
    const areaForQuote = resolved ? withMeasuredDistance(resolved.input, raw.distance_source ?? null) : null;
    const unwaived = quoteFulfilment({
      area: areaForQuote,
      mode,
      rider,
      bus: {
        cards,
        office,
        parcels,
        destinationTown: town,
        destinationDistrict,
        at,
        declaredValueUgx: subtotalUgx || null,
      },
      subtotalUgx,
      proportionality: {
        feeToValueRatioCeiling: numeric.fee_to_value_ratio_ceiling ?? null,
        minOrderValueUgx: minOrderValuesFromConfig(numeric),
        // The zone's own threshold wins when its zone is active and sets one;
        // otherwise the shop-wide figure, exactly as before.
        freeDeliveryThresholdUgx,
      },
    });
    // The threshold WAIVES the fee here, in the one quoting service, so the
    // panel that says "qualifies for free delivery" and the order agree.
    const quote = applyFreeDeliveryThreshold(unwaived, { thresholdUgx: freeDeliveryThresholdUgx, basisUgx: subtotalUgx });

    // §4.6: the pin nudge is a cost-based, within-area statement or nothing. Both
    // sides of this area's last-mile split must be learned, and the difference
    // must move the fee by at least one rounding step after the same waiver.
    let pinSavingUgx: number | null = null;
    if (!hasPin && withPin && withPin.kind !== 'prior' && factors.lastMile.kind !== 'prior' && unwaived.kind === 'rider_delivery' && unwaived.feeUgx > 0) {
      const pinned = applyFreeDeliveryThreshold(
        quoteFulfilment({
          area: areaForQuote,
          mode,
          rider: { ...rider, hasPin: true, lastMileMinutes: withPin },
          bus: { cards, office, parcels, destinationTown: town, destinationDistrict, at, declaredValueUgx: subtotalUgx || null },
          subtotalUgx,
          proportionality: {
            feeToValueRatioCeiling: numeric.fee_to_value_ratio_ceiling ?? null,
            minOrderValueUgx: minOrderValuesFromConfig(numeric),
            freeDeliveryThresholdUgx,
          },
        }),
        { thresholdUgx: freeDeliveryThresholdUgx, basisUgx: subtotalUgx },
      );
      const step = numeric.fee_rounding_step_ugx ?? 0;
      if (pinned.kind === 'rider_delivery' && quote.kind === 'rider_delivery') {
        const diff = quote.feeUgx - pinned.feeUgx;
        if (diff > 0 && diff >= step) pinSavingUgx = diff;
      }
    }

    return {
      quote,
      resolved,
      pricedBy: quote.kind === 'rider_delivery' ? 'delivery_model' : quote.kind === 'bus_shipment' ? 'bus_rate_card' : 'manual',
      // ONLY config-incomplete. Every other reason is a correct answer, and
      // handing a correct answer to the legacy path would replace it with a
      // wrong one — the legacy model would happily price a lake island.
      mayFallBackToLegacy: quote.kind === 'unavailable' && quote.reason === 'CONFIG_INCOMPLETE',
      freeDeliveryThresholdUgx:
        freeDeliveryThresholdUgx !== null && Number.isFinite(freeDeliveryThresholdUgx) && freeDeliveryThresholdUgx > 0
          ? freeDeliveryThresholdUgx
          : null,
      thresholdBasisUgx: subtotalUgx,
      pinSavingUgx,
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
