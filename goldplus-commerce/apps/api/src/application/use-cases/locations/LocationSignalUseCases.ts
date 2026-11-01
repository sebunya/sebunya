import type { DeliverToPlace, ILocationSignalStore } from '../../ports/ILocationSignalStore';
import { areaPointFlags, feeShockAreas, medianPoint, parseLocationSignal, type AreaDemandRow, type AreaPointFlag } from '../../../domain/locations/LocationSignals';

/**
 * Records one location signal, linked to the visitor's profile and customer so it personalises their experience
 * (owner decision 2026-10-16). Their consent state is recorded on the row, for marketing uses that respect it.
 * A "Locate me" row keeps the customer's own pin and its distance to the chosen area's point.
 */
export class RecordLocationSignalUseCase {
  constructor(private readonly store: ILocationSignalStore) {}

  async execute(input: { raw: unknown; profileId: string | null; customerId: string | null }): Promise<'recorded' | 'invalid'> {
    const s = parseLocationSignal(input.raw);
    if (!s) return 'invalid';
    if (s.kind === 'deliver_to_set' && input.profileId && s.district) {
      // The customer's own service preference: kept on their profile whatever their personalisation choice,
      // because it only ever prices and promises for the place they asked for.
      await this.store.setDeliverTo(input.profileId, { areaSlug: s.areaSlug, district: s.district, label: s.label ?? s.district });
    }
    const consent = await this.store.consentFor(input.profileId, input.customerId);
    const offerKm = s.pin && s.areaSlug ? await this.store.kmToAreaPoint(s.areaSlug, s.pin).catch(() => null) : null;
    await this.store.insert({
      kind: s.kind,
      surface: s.surface,
      profileId: input.profileId,
      customerId: consent.customerId,
      areaSlug: s.areaSlug,
      district: s.district,
      feeUgx: s.feeUgx,
      quoteKind: s.quoteKind,
      offerRank: s.offerRank,
      offerKm,
      personalisation: consent.personalisation,
      pin: s.pin,
    });
    return 'recorded';
  }
}

/** "Deliver to" for a visitor: their profile's, else (signed in) their newest on any device. */
export class GetDeliverToUseCase {
  constructor(private readonly store: ILocationSignalStore) {}

  async execute(input: { profileId: string | null; customerId: string | null }): Promise<DeliverToPlace | null> {
    if (input.profileId) {
      const own = await this.store.deliverToForProfile(input.profileId);
      if (own) return own;
    }
    return input.customerId ? this.store.deliverToForCustomer(input.customerId) : null;
  }
}

export interface LocationDemandReport {
  days: number;
  areas: AreaDemandRow[];
  feeShock: Array<AreaDemandRow & { conversion: number }>;
  areaPointFlags: AreaPointFlag[];
}

export class LocationDemandReportUseCase {
  constructor(private readonly store: ILocationSignalStore) {}

  async execute(days: number): Promise<LocationDemandReport> {
    const d = Number.isInteger(days) && days >= 1 && days <= 365 ? days : 30;
    const [areas, pins] = await Promise.all([this.store.demandByArea(d), this.store.chosenPins(Math.max(d, 90))]);
    // A flagged area comes with where customers who chose it really were (a person decides whether to move it).
    const flags = areaPointFlags(areas).map((f) => ({ ...f, suggestedPoint: f.areaSlug ? medianPoint(pins.get(f.areaSlug) ?? []) : null }));
    return { days: d, areas, feeShock: feeShockAreas(areas).slice(0, 10), areaPointFlags: flags };
  }
}
