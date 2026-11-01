/**
 * Copy that uses the customer's delivery area (2026-10-16). One place, so every surface speaks the same way and the
 * rules below hold everywhere:
 *
 *  1. Only the area the customer TOLD us ("Deliver to", their checkout) — never inferred, never a pin.
 *  2. The area's name, never the spot: no distance from their home, no street, no "near you" pointing at a door.
 *  3. Frame the service, not the person: "we deliver to Najjera", never "we know you're in Najjera".
 *  4. Never replay behaviour: no "you looked at", no "you checked this fee", no visit counts.
 *  5. Other people only in aggregate, named by place: "popular in Najjera", never "your neighbour bought".
 *  6. Every line that uses the area sits next to a way to change it.
 *  7. Urgency only when true: the real cut-off, never invented scarcity.
 *
 * tests/unit/LocationCopy.test.ts checks every line here against a list of creepy phrasings.
 */

/** "Najjera, Wakiso" → "Najjera"; a district alone stays itself. */
export function areaNameFromLabel(label: string | null | undefined): string {
  const first = String(label ?? '').split(',')[0]?.trim() ?? '';
  return first.slice(0, 40);
}

/** The "Deliver to" chip. */
export function deliveringToLine(label: string): string {
  return `Delivering to ${areaNameFromLabel(label)}`;
}

/** The cut-off line for an area in the same-day dispatch zone, with the real minutes left. */
export function sameDayAreaLine(areaName: string, minsToCutoff: number): string {
  if (minsToCutoff <= 60) return `Only ${minsToCutoff} minutes left for this to go out to ${areaName} today`;
  const h = Math.floor(minsToCutoff / 60);
  const m = minsToCutoff % 60;
  return `Order in ${h}h ${m}m and it goes out to ${areaName} today`;
}

/** Outside the same-day zone: what is actually true for them. */
export function outsideSameDayLine(areaName: string): string {
  return `Same-day dispatch is for Kampala & Wakiso. We confirm your ${areaName} delivery day by phone`;
}

/** The header line for a customer whose area is outside the same-day zone (instead of saying nothing). */
export function upcountryNavLine(areaName: string): { text: string; short: string } {
  return {
    text: `Delivering to <b>${escapeHtml(areaName)}</b>? We confirm your delivery day by phone`,
    short: `Delivering to <b>${escapeHtml(areaName)}</b>: we call to confirm the day`,
  };
}

/** "Popular in <area>" rail. Aggregate, named by place, and honest about the evidence window. */
export function popularNearYouCopy(scope: 'area' | 'district' | 'greater_kampala' | null, label: string): { title: string; subtitle: string } {
  const name = areaNameFromLabel(label);
  if (scope === 'area') return { title: `Popular in ${name}`, subtitle: `What ${name} customers have been buying lately.` };
  if (scope === 'district') return { title: `Popular across ${name}`, subtitle: `What customers across ${name} have been buying lately.` };
  return { title: 'Popular around Kampala', subtitle: 'What customers across Greater Kampala have been buying lately.' };
}

/** Per-card reason in that rail. */
export function boughtNearbyReason(buyers: number, label: string): string {
  return `${buyers} ${areaNameFromLabel(label)} customers bought this`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
