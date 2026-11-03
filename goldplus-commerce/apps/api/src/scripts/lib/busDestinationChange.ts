/**
 * Whether an upsert of one bus destination changed what was stored. Every column the upsert writes
 * (except the data_version stamp) is compared, so a notes or areas_in_district edit counts as a change. Pure.
 */
export interface BusDestinationValues {
  matching_district: unknown; region: unknown; current_zone: unknown; areas_in_district: unknown; notes: unknown;
}
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function busDestinationChanged(before: BusDestinationValues, next: BusDestinationValues): boolean {
  return (['matching_district', 'region', 'current_zone', 'areas_in_district', 'notes'] as const)
    .some((k) => text(before[k]) !== text(next[k]));
}
