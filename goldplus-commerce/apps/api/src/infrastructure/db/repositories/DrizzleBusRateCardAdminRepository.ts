import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IBusRateCardAdminRepository, ParcelOfficeRow, RateCardRow } from '../../../application/use-cases/delivery/BusRateCardAdminUseCases';

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] })?.rows ?? []));

const toCard = (c: Row): RateCardRow => ({
  id: String(c.id),
  carrier: String(c.carrier),
  destinationTown: String(c.destination_town),
  destinationDistrict: String(c.destination_district),
  parcelClass: String(c.parcel_class) as RateCardRow['parcelClass'],
  feeUgx: Number(c.fee_ugx),
  insurancePctOfDeclaredValue: c.insurance_pct_of_declared_value === null ? null : Number(c.insurance_pct_of_declared_value),
  transitDaysMin: Number(c.transit_days_min),
  transitDaysMax: Number(c.transit_days_max),
  chargedAt: String(c.charged_at) as RateCardRow['chargedAt'],
  effectiveFrom: new Date(String(c.effective_from)),
  effectiveTo: c.effective_to === null ? null : new Date(String(c.effective_to)),
  version: Number(c.version),
  sourceNote: c.source_note === null ? null : String(c.source_note),
  carrierKind: (c.carrier_kind === 'taxi' || c.carrier_kind === 'special' ? c.carrier_kind : 'bus') as RateCardRow['carrierKind'],
  handoverPoint: c.handover_point === null || c.handover_point === undefined ? null : String(c.handover_point),
});

const toOffice = (o: Row): ParcelOfficeRow => ({
  id: String(o.id),
  carrier: String(o.carrier ?? ''),
  name: String(o.name),
  town: String(o.town ?? ''),
  district: String(o.district ?? ''),
  physicalAddress: o.physical_address === null ? null : String(o.physical_address),
  landmarkText: o.landmark_text === null ? null : String(o.landmark_text),
  phone: o.phone === null ? null : String(o.phone),
  departureTimes: o.departure_times === null ? null : String(o.departure_times),
  collectionWindow: o.collection_window === null ? null : String(o.collection_window),
  active: Boolean(o.active),
});

const CARD_COLS = sql`id, carrier, destination_town, destination_district, parcel_class, fee_ugx, insurance_pct_of_declared_value,
  transit_days_min, transit_days_max, charged_at, effective_from, effective_to, version, source_note, carrier_kind, handover_point`;

export class DrizzleBusRateCardAdminRepository implements IBusRateCardAdminRepository {
  async listCards(): Promise<RateCardRow[]> {
    return rows(await db.execute(sql`select ${CARD_COLS} from delivery_bus_rate_card
      order by (effective_to is null) desc, destination_district, destination_town, carrier, parcel_class, version desc`)).map(toCard);
  }

  async supersedeCard(input: Parameters<IBusRateCardAdminRepository['supersedeCard']>[0]): Promise<RateCardRow> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('delivery_bus_rate_card'))`);
      const [prev] = rows(await tx.execute(sql`
        select id, version from delivery_bus_rate_card
        where lower(carrier) = lower(${input.carrier}) and lower(destination_town) = lower(${input.destinationTown})
          and lower(destination_district) = lower(${input.destinationDistrict}) and parcel_class = ${input.parcelClass}
        order by version desc limit 1`));
      const version = prev ? Number(prev.version) + 1 : 1;
      if (prev) {
        await tx.execute(sql`update delivery_bus_rate_card set effective_to = ${input.now}
          where id = ${String(prev.id)} and (effective_to is null or effective_to > ${input.now})`);
      }
      const [row] = rows(await tx.execute(sql`
        insert into delivery_bus_rate_card
          (carrier, destination_town, destination_district, parcel_class, fee_ugx, insurance_pct_of_declared_value,
           transit_days_min, transit_days_max, charged_at, effective_from, effective_to, version, source_note, created_by, carrier_kind, handover_point)
        values (${input.carrier}, ${input.destinationTown}, ${input.destinationDistrict}, ${input.parcelClass}, ${input.feeUgx},
                ${input.insurancePctOfDeclaredValue}, ${input.transitDaysMin}, ${input.transitDaysMax}, ${input.chargedAt},
                ${input.now}, null, ${version}, ${input.sourceNote}, ${input.createdBy}, ${input.carrierKind}, ${input.handoverPoint})
        returning ${CARD_COLS}`));
      return toCard(row);
    });
  }

  async expireCard(id: string, now: Date): Promise<boolean> {
    const r = (await db.execute(sql`update delivery_bus_rate_card set effective_to = ${now}
      where id = ${id} and (effective_to is null or effective_to > ${now})`)) as unknown as { count?: number };
    return Number(r?.count ?? 0) === 1;
  }

  async listOffices(): Promise<ParcelOfficeRow[]> {
    return rows(await db.execute(sql`
      select id, carrier, name, town, district, physical_address, landmark_text, phone, departure_times, collection_window, active
      from ug_pickup_point where operator = 'bus_parcel_office' order by active desc, district, town, carrier`)).map(toOffice);
  }

  async upsertOffice(input: Omit<ParcelOfficeRow, 'id' | 'active'> & { active: boolean }): Promise<ParcelOfficeRow> {
    const [existing] = rows(await db.execute(sql`
      select id from ug_pickup_point where operator = 'bus_parcel_office'
        and lower(carrier) = lower(${input.carrier}) and lower(town) = lower(${input.town}) limit 1`));
    const [row] = existing
      ? rows(await db.execute(sql`
          update ug_pickup_point set name = ${input.name}, district = ${input.district}, physical_address = ${input.physicalAddress},
            landmark_text = ${input.landmarkText}, phone = ${input.phone}, departure_times = ${input.departureTimes},
            collection_window = ${input.collectionWindow}, active = ${input.active}, updated_at = now()
          where id = ${String(existing.id)}
          returning id, carrier, name, town, district, physical_address, landmark_text, phone, departure_times, collection_window, active`))
      : rows(await db.execute(sql`
          insert into ug_pickup_point (name, operator, carrier, town, district, physical_address, landmark_text, phone, departure_times, collection_window, active)
          values (${input.name}, 'bus_parcel_office', ${input.carrier}, ${input.town}, ${input.district}, ${input.physicalAddress},
                  ${input.landmarkText}, ${input.phone}, ${input.departureTimes}, ${input.collectionWindow}, ${input.active})
          returning id, carrier, name, town, district, physical_address, landmark_text, phone, departure_times, collection_window, active`));
    return toOffice(row);
  }

  async setOfficeActive(id: string, active: boolean): Promise<boolean> {
    const r = (await db.execute(sql`update ug_pickup_point set active = ${active}, updated_at = now()
      where id = ${id} and operator = 'bus_parcel_office'`)) as unknown as { count?: number };
    return Number(r?.count ?? 0) === 1;
  }
}
