/**
 * Bus rate cards and parcel offices, written by a person (2026-10-16).
 *
 * Everything beyond the rider ring ships by bus to a parcel office, and until
 * today there was no way to enter the negotiated prices: the table existed, the
 * quote read it, nobody could write it, so every upcountry customer saw "we
 * ship to your area by bus but have no current price". This is the write path.
 *
 * A card is a NEGOTIATED price for one carrier, one town, one parcel class.
 * Entering a new price for the same key closes the previous card (effective_to
 * = now) and opens version n+1, so a disputed charge can always be traced to
 * the card that priced it. Nothing here interpolates or copies a neighbour's
 * price (DeliveryBusRateCard.ts holds the prohibitions).
 */
import { normalizeUgandaDistrict } from '@goldplus/shared';
import { SHIPPING_CLASSES, type ShippingClass } from '../../../domain/delivery/DeliveryParcelClass';
import { isCarrierKind, type CarrierKind, type ChargedAt } from '../../../domain/delivery/DeliveryBusRateCard';

export interface RateCardRow {
  id: string;
  carrier: string;
  destinationTown: string;
  destinationDistrict: string;
  parcelClass: ShippingClass;
  feeUgx: number;
  insurancePctOfDeclaredValue: number | null;
  transitDaysMin: number;
  transitDaysMax: number;
  chargedAt: ChargedAt;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  version: number;
  sourceNote: string | null;
  carrierKind: CarrierKind;
  handoverPoint: string | null;
}

export interface ParcelOfficeRow {
  id: string;
  carrier: string;
  name: string;
  town: string;
  district: string;
  physicalAddress: string | null;
  landmarkText: string | null;
  phone: string | null;
  departureTimes: string | null;
  collectionWindow: string | null;
  active: boolean;
}

export interface IBusRateCardAdminRepository {
  listCards(): Promise<RateCardRow[]>;
  /** Closes the current card for the key (if any) and inserts the next version, in one transaction. */
  supersedeCard(input: {
    carrier: string;
    destinationTown: string;
    destinationDistrict: string;
    parcelClass: ShippingClass;
    feeUgx: number;
    insurancePctOfDeclaredValue: number | null;
    transitDaysMin: number;
    transitDaysMax: number;
    chargedAt: ChargedAt;
    sourceNote: string | null;
    createdBy: string | null;
    now: Date;
    carrierKind: CarrierKind;
    handoverPoint: string | null;
  }): Promise<RateCardRow>;
  expireCard(id: string, now: Date): Promise<boolean>;
  listOffices(): Promise<ParcelOfficeRow[]>;
  upsertOffice(input: Omit<ParcelOfficeRow, 'id' | 'active'> & { active: boolean }): Promise<ParcelOfficeRow>;
  setOfficeActive(id: string, active: boolean): Promise<boolean>;
}

type Fail = { ok: false; code: 'INVALID_INPUT' | 'NOT_FOUND'; message: string };
const fail = (code: Fail['code'], message: string): Fail => ({ ok: false, code, message });

const clean = (s: unknown, max: number) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

export class BusRateCardAdminUseCases {
  constructor(private readonly repo: IBusRateCardAdminRepository) {}

  async list(): Promise<{ cards: RateCardRow[]; offices: ParcelOfficeRow[] }> {
    const [cards, offices] = await Promise.all([this.repo.listCards(), this.repo.listOffices()]);
    return { cards, offices };
  }

  /**
   * One destination, up to three prices (one per parcel class). A class left
   * blank is NOT entered: a blank is "no price negotiated", never zero.
   */
  async setPrices(input: {
    carrier: string;
    destinationTown: string;
    destinationDistrict: string;
    /** taxi | bus | special. 'special' carries no prices: the team quotes by phone. */
    carrierKind: string;
    /** The stage or office the customer collects from, in the carrier's words. */
    handoverPoint: string | null;
    fees: Partial<Record<ShippingClass, number | null>>;
    insurancePctOfDeclaredValue: number | null;
    transitDaysMin: number;
    transitDaysMax: number;
    chargedAt: string;
    sourceNote: string | null;
    actorId: string | null;
    now?: Date;
  }): Promise<{ ok: true; cards: RateCardRow[] } | Fail> {
    const carrier = clean(input.carrier, 80);
    const town = clean(input.destinationTown, 120);
    const district = normalizeUgandaDistrict(input.destinationDistrict);
    if (carrier.length < 2) return fail('INVALID_INPUT', 'Name the carrier (the bus company).');
    if (town.length < 2) return fail('INVALID_INPUT', 'Name the destination town, as the parcel office calls it.');
    if (!district) return fail('INVALID_INPUT', `"${input.destinationDistrict}" is not a Uganda district.`);
    if (!isCarrierKind(input.carrierKind)) return fail('INVALID_INPUT', 'Say how it travels: taxi, bus, or a special arrangement.');
    if (input.chargedAt !== 'sending' && input.chargedAt !== 'collection') {
      return fail('INVALID_INPUT', 'Say who pays the carrier: at sending (we pay, it goes on the order) or at collection (the customer pays the office).');
    }
    const tMin = Number(input.transitDaysMin);
    const tMax = Number(input.transitDaysMax);
    if (!Number.isInteger(tMin) || !Number.isInteger(tMax) || tMin < 0 || tMax < tMin || tMax > 30) {
      return fail('INVALID_INPUT', 'Transit days must be whole numbers, 0 to 30, with the maximum not below the minimum.');
    }
    const ins = input.insurancePctOfDeclaredValue;
    if (ins !== null && (!Number.isFinite(ins) || ins < 0 || ins > 100)) {
      return fail('INVALID_INPUT', 'Insurance is a percentage of declared value, 0 to 100, or blank when the carrier offers no cover.');
    }
    const entries: Array<[ShippingClass, number]> = [];
    if (input.carrierKind === 'special') {
      // Served by a person: one card per class so every basket resolves to "we arrange it", never to "no card".
      for (const cls of SHIPPING_CLASSES) entries.push([cls, 0]);
    } else {
      for (const cls of SHIPPING_CLASSES) {
        const v = input.fees[cls];
        if (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))) continue;
        if (!Number.isInteger(v) || v < 0 || v > 5_000_000) return fail('INVALID_INPUT', `The ${cls} parcel price must be a whole number of shillings.`);
        entries.push([cls, v]);
      }
      if (entries.length === 0) return fail('INVALID_INPUT', 'Enter at least one parcel price (small, medium or large).');
    }

    const now = input.now ?? new Date();
    const cards: RateCardRow[] = [];
    for (const [parcelClass, feeUgx] of entries) {
      cards.push(
        await this.repo.supersedeCard({
          carrier,
          destinationTown: town,
          destinationDistrict: district,
          parcelClass,
          feeUgx,
          insurancePctOfDeclaredValue: ins,
          transitDaysMin: tMin,
          transitDaysMax: tMax,
          chargedAt: input.chargedAt,
          sourceNote: input.sourceNote ? clean(input.sourceNote, 500) : null,
          createdBy: input.actorId,
          now,
          carrierKind: input.carrierKind,
          handoverPoint: input.handoverPoint ? clean(input.handoverPoint, 160) : null,
        }),
      );
    }
    return { ok: true, cards };
  }

  async expire(id: string, now: Date = new Date()): Promise<{ ok: true } | Fail> {
    return (await this.repo.expireCard(id, now)) ? { ok: true } : fail('NOT_FOUND', 'No current card with that id.');
  }

  async setOffice(input: {
    carrier: string;
    name: string;
    town: string;
    district: string;
    physicalAddress: string | null;
    landmarkText: string | null;
    phone: string | null;
    departureTimes: string | null;
    collectionWindow: string | null;
  }): Promise<{ ok: true; office: ParcelOfficeRow } | Fail> {
    const carrier = clean(input.carrier, 80);
    const name = clean(input.name, 160);
    const town = clean(input.town, 120);
    const district = normalizeUgandaDistrict(input.district);
    if (carrier.length < 2 || name.length < 2 || town.length < 2) return fail('INVALID_INPUT', 'Carrier, office name and town are all needed.');
    if (!district) return fail('INVALID_INPUT', `"${input.district}" is not a Uganda district.`);
    const office = await this.repo.upsertOffice({
      carrier,
      name,
      town,
      district,
      physicalAddress: input.physicalAddress ? clean(input.physicalAddress, 300) : null,
      landmarkText: input.landmarkText ? clean(input.landmarkText, 300) : null,
      phone: input.phone ? clean(input.phone, 20) : null,
      departureTimes: input.departureTimes ? clean(input.departureTimes, 200) : null,
      collectionWindow: input.collectionWindow ? clean(input.collectionWindow, 200) : null,
      active: true,
    });
    return { ok: true, office };
  }

  async setOfficeActive(id: string, active: boolean): Promise<{ ok: true } | Fail> {
    return (await this.repo.setOfficeActive(id, active)) ? { ok: true } : fail('NOT_FOUND', 'No parcel office with that id.');
  }
}
