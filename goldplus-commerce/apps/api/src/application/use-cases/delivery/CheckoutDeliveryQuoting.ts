import { toEatParts } from '@goldplus/shared';
import { isShopCollectionOperator } from '../../../domain/locations/CollectionPoints';
import { orderChargeBeforeFreeDeliveryUgx, orderChargeUgx } from '../../../domain/delivery/DeliveryQuoteService';
import { appLogger } from '../../logging/appLogger';
import type { ManagePickupPointsUseCase } from '../locations/LocationAdminUseCases';
import type { DeliveryQuotingUseCase } from './DeliveryQuotingUseCase';
import type { IDeliveryCaptureRepository } from './DeliveryCaptureUseCases';

/**
 * What the checkout delivery adapter reaches for. The names are the composition
 * root's own member names, and the composition root passes ITSELF: every
 * dependency is read when a quote is asked for, not when the adapter is built,
 * exactly as when this adapter lived inside the Registry.
 */
export interface CheckoutDeliveryQuotingPorts {
  readonly managePickupPointsUseCase: Pick<ManagePickupPointsUseCase, 'list'>;
  readonly deliveryQuotingUseCase: Pick<DeliveryQuotingUseCase, 'execute'>;
  readonly deliveryCaptureRepo: Pick<IDeliveryCaptureRepository, 'upsert'>;
}

/**
 * The adapter checkout holds. Deliberately narrow: checkout needs a fee, a
 * confirmed flag, and whether it may fall back — not the whole quote shape.
 * The delivery estimate uses the same adapter, so the figure the page shows is
 * the figure the order is charged. (Moved out of the Registry, 2026-11; the
 * body is exactly the one the Registry held.)
 */
export function buildCheckoutDeliveryQuoting(ports: CheckoutDeliveryQuotingPorts) {
  return {
    quote: async (input: {
      areaSlug?: string | null;
      deliveryArea?: string | null;
      district?: string | null;
      items: ReadonlyArray<{ productId: string; quantity: number }>;
      point?: { lat: number; lng: number } | null;
      pickupPointId?: string | null;
    }) => {
      // Collect from one of our own shops: nothing travels, so nothing is charged and nothing is quoted.
      // Only an ACTIVE point that is one of OUR collection points qualifies; a carrier's stage or office upcountry
      // is a shipment destination, priced by its card, never a free pickup.
      if (input.pickupPointId) {
        const point = (await ports.managePickupPointsUseCase.list()).find((p) => p.id === input.pickupPointId);
        if (!point || !point.active || !isShopCollectionOperator(point.operator)) {
          throw new Error('PICKUP_POINT_UNAVAILABLE: That collection point is not available. Choose another, or ask for delivery.');
        }
        return {
          feeUgx: 0,
          freeDeliveryThresholdUgx: null,
          feeBeforeFreeDeliveryUgx: 0,
          confirmed: true,
          pricedBy: 'manual' as const,
          mayFallBackToLegacy: false,
          capture: { fulfilmentMode: 'pickup_only', pricedBy: 'manual', quotedFeeUgx: 0 },
        };
      }
      // One instant for the quote AND its capture, so the recorded hour of week is
      // the one the hour factor was applied at (the use case derives it the same way).
      const at = new Date();
      const eatParts = toEatParts(at);
      const outcome = await ports.deliveryQuotingUseCase.execute({ ...input, at });
      const q = outcome.quote;
      // What the ORDER charges: a pay-on-collection rate card is paid to the
      // carrier at the parcel office, never in the order as well.
      const charge = orderChargeUgx(q);
      return {
        feeUgx: charge,
        // Paid to the carrier at the parcel office: the order charges 0, and the page says what is paid there.
        paidAtCollectionUgx: q.kind === 'bus_shipment' && q.shipment.chargedAt === 'collection' ? q.feeUgx : null,
        // Checkout re-decides the free-delivery waiver on the post-promotion
        // goods total, which it only knows after pricing; these let it do that
        // without a second quote.
        freeDeliveryThresholdUgx: outcome.freeDeliveryThresholdUgx,
        feeBeforeFreeDeliveryUgx: orderChargeBeforeFreeDeliveryUgx(q),
        // A quote we produced is CONFIRMED. A refusal is not a zero fee that
        // happens to be right — it is an unconfirmed fee the team will settle.
        confirmed: q.kind !== 'unavailable',
        pricedBy: outcome.pricedBy,
        mayFallBackToLegacy: outcome.mayFallBackToLegacy,
        // Why it refused, so a caller without a basket can tell a destination we
        // cannot serve from a question it did not ask properly.
        unavailableReason: q.kind === 'unavailable' ? q.reason : null,
        capture: {
          // A district-only resolution carries an EMPTY slug, which is not a
          // slug. Stored as null so "no area" reads as absence rather than as
          // an area whose name is nothing.
          areaSlug: q.explanation.areaSlug || null,
          corridor: q.explanation.corridor,
          distanceBand: q.explanation.band,
          quotedFeeUgx: charge,
          expectedMinutes: q.kind === 'rider_delivery' ? q.expectedMinutes : null,
          centroidSource: q.explanation.centroidSource,
          // 0189: how well the location was known, and the point distance the
          // quote could have used, whether or not distance_source let it.
          accuracyTier: q.explanation.accuracyTier,
          centroidKm: q.explanation.centroidKm,
          centroidExpectedErrorM: q.explanation.centroidExpectedErrorM,
          distanceSource: q.explanation.distanceSource,
          configVersionId: q.explanation.configVersionId,
          aliasUsed: outcome.resolved?.aliasUsed ?? null,
          // 0152: what the hour and detour fits learn from. The straight line is
          // the round trip before detour, comparable to the distance a rider records.
          eatHourOfWeek: eatParts.weekday * 24 + eatParts.hour,
          straightLineKm: q.explanation.oneWayKm !== null ? q.explanation.oneWayKm * 2 : null,
          fulfilmentMode: q.mode ?? null,
          carrier: q.kind === 'bus_shipment' ? q.shipment.carrier : null,
          rateCardId: q.kind === 'bus_shipment' ? q.shipment.rateCardId : null,
          rateCardVersion: q.kind === 'bus_shipment' ? q.shipment.rateCardVersion : null,
          parcelClass: q.kind === 'bus_shipment' ? q.shipment.parcelClass : null,
          parcelCount: q.kind === 'bus_shipment' ? q.parcelCount : null,
          perParcelFeeUgx: q.kind === 'bus_shipment' ? q.perParcelFeeUgx : null,
          unavailableReason: q.kind === 'unavailable' ? q.reason : null,
        },
      };
    },
    recordQuote: async (orderId: string, capture: Record<string, unknown>) => {
      await ports.deliveryCaptureRepo.upsert({ orderId, ...(capture as Record<string, never>) });
    },
    /**
     * A capture that fails is an observation the model will never get. It must
     * not void the order — but it must not vanish either, which is the whole
     * lesson of the skipped lifecycle mirrors.
     */
    onCaptureFailed: (orderId: string, error: unknown) => {
      appLogger.error(
        { orderId, err: error },
        '[delivery] capture write FAILED for a placed order — the model loses this observation permanently',
      );
    },
  };
}
