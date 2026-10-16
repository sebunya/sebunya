/**
 * Greater Kampala: the districts the gazetteer flags is_metro (Kampala, Wakiso, Mukono, Mpigi — the Greater
 * Kampala Metropolitan Area). Owner direction 2026-10-16: Wakiso (Kira, Najjera…) and Mukono are as much "home" as
 * Kampala proper. Same-day DISPATCH is a separate, narrower promise (Kampala & Wakiso) and lives elsewhere.
 */
export const GREATER_KAMPALA_DISTRICTS = ['Kampala', 'Wakiso', 'Mukono', 'Mpigi'] as const;

export function isGreaterKampala(district: string | null | undefined): boolean {
  const d = String(district ?? '').trim().toLowerCase();
  return GREATER_KAMPALA_DISTRICTS.some((g) => g.toLowerCase() === d);
}

/** A collection order's area line, as checkout writes it ("Pickup point: GoldPlus shop, …"). */
export function isCollectionAreaLine(areaLine: string | null | undefined): boolean {
  return /^\s*pickup point:/i.test(String(areaLine ?? ''));
}

/** The area part of an order's area label: "Najjera, Wakiso" → "Najjera". */
export function areaNameOf(label: string | null | undefined): string | null {
  const first = String(label ?? '').split(',')[0]?.trim();
  return first ? first.slice(0, 80) : null;
}

/** Same-day DISPATCH (narrower than Greater Kampala): the districts the storefront promises it for. */
export const SAME_DAY_DISPATCH_DISTRICTS = ['Kampala', 'Wakiso'] as const;

export function isSameDayDispatchDistrict(district: string | null | undefined): boolean {
  const d = String(district ?? '').trim().toLowerCase();
  return SAME_DAY_DISPATCH_DISTRICTS.some((g) => g.toLowerCase() === d);
}
