import type { DeliverToPlace, ILocationSignalStore } from '../../ports/ILocationSignalStore';
import { areaPointFlags, feeShockAreas, parseLocationSignal, type AreaDemandRow, type AreaPointFlag } from '../../../domain/locations/LocationSignals';

/**
 * Records one location signal. Consent decides the link: with personalisation granted the row carries the profile
 * and customer (it may then personalise their experience and appear in their Customer 360); without it the row is
 * anonymous and only ever counted per area. A "Locate me" pin is turned into a distance and discarded.
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
      profileId: consent.personalisation ? input.profileId : null,
      customerId: consent.personalisation ? consent.customerId : null,
      areaSlug: s.areaSlug,
      district: s.district,
      feeUgx: s.feeUgx,
      quoteKind: s.quoteKind,
      offerRank: s.offerRank,
      offerKm,
      personalisation: consent.personalisation,
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
    const areas = await this.store.demandByArea(d);
    return { days: d, areas, feeShock: feeShockAreas(areas).slice(0, 10), areaPointFlags: areaPointFlags(areas) };
  }
}
