import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  areaNameFromLabel, boughtNearbyReason, deliveringToLine, outsideSameDayLine, popularNearYouCopy, sameDayAreaLine, upcountryNavLine,
} from '../../packages/shared/src/locations/locationCopy';
import { computeNbaCandidates } from '../../packages/shared/src/nav/nba';
import { sameDayCutoffCopy, sameDayLineFor } from '../../apps/web/src/lib/checkout';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** Phrasings that make location copy feel like surveillance. None may appear in anything we generate. */
const CREEPY = [
  /near you\b/i, /your (home|house|door|street|location|neighbou?rs?)/i, /we (know|noticed|saw|see|tracked)/i,
  /you (looked|viewed|checked|visited|were)/i, /\bmetres?\b|\bkm\b|kilomet/i, /people like you/i, /around you/i, /your exact/i,
];

function everyLine(area: string, district: string): string[] {
  const label = `${area}, ${district}`;
  const up = upcountryNavLine(label);
  const lines = [
    deliveringToLine(label), sameDayAreaLine(area, 185), sameDayAreaLine(area, 40), outsideSameDayLine(area), up.text, up.short,
    boughtNearbyReason(7, label),
    ...(['area', 'district', 'greater_kampala'] as const).flatMap((s) => Object.values(popularNearYouCopy(s, s === 'area' ? label : district))),
  ];
  const copy = sameDayCutoffCopy({ closed: false, beforeCutoff: true, minsToCutoff: 125 });
  lines.push(sameDayLineFor(copy, district, label), sameDayLineFor(copy, 'Mbarara', 'Kakoba, Mbarara'));
  for (const c of computeNbaCandidates({ signedIn: false, visits: 2, cart: 1, points: 0, lastOrderDays: null, orderInTransit: false, beforeCutoff: true, minsToCutoff: 90, sunday: false, saleLive: false, deliverTo: { label: area, sameDay: true } })) lines.push(c.text, c.short ?? '');
  for (const c of computeNbaCandidates({ signedIn: false, visits: 2, cart: 0, points: 0, lastOrderDays: null, orderInTransit: false, beforeCutoff: true, minsToCutoff: 90, sunday: false, saleLive: false, deliverTo: { label: 'Mbarara', sameDay: false } })) lines.push(c.text, c.short ?? '');
  return lines.filter(Boolean);
}

describe('location copy is relevant without feeling creepy', () => {
  it('no generated line uses a surveillance phrasing', () => {
    for (const line of everyLine('Najjera', 'Wakiso')) for (const bad of CREEPY) expect(line, line).not.toMatch(bad);
  });

  it('names the area the customer gave, never more than the area', () => {
    expect(areaNameFromLabel('Najjera, Wakiso')).toBe('Najjera');
    expect(deliveringToLine('Najjera, Wakiso')).toBe('Delivering to Najjera');
    expect(sameDayAreaLine('Najjera', 185)).toBe('Order in 3h 5m and it goes out to Najjera today');
    expect(sameDayAreaLine('Najjera', 40)).toBe('Only 40 minutes left for this to go out to Najjera today');
    expect(outsideSameDayLine('Mbarara')).toBe('Same-day dispatch is for Kampala & Wakiso. We confirm your Mbarara delivery day by phone');
  });

  it('cart and checkout lines name the area when known, and stay general when not', () => {
    const copy = sameDayCutoffCopy({ closed: false, beforeCutoff: true, minsToCutoff: 125 });
    expect(sameDayLineFor(copy, 'Wakiso', 'Kira, Wakiso')).toBe('Order in 2h 5m and it goes out to Kira today');
    expect(sameDayLineFor(copy, 'Wakiso')).toBe('Order in 2h 5m and this goes out today');
    expect(sameDayLineFor(copy, null, 'Kira, Wakiso')).toMatch(/^Kampala & Wakiso: /);
    const closed = sameDayCutoffCopy({ closed: true, beforeCutoff: false, minsToCutoff: 0 });
    expect(sameDayLineFor(closed, 'Wakiso', 'Kira, Wakiso')).toMatch(/^Closed today/);
  });

  it('checkout names only a structured picked area, never saved-address details or written directions', () => {
    const page = read('apps/web/src/pages/checkout.astro');
    expect(page).toMatch(/setCutoffFor\(district, copyArea\)/);
    expect(page).toMatch(/refreshEstimate\(r\.dataset\.district \?\? null, r\.dataset\.area \|\| null, r\.dataset\.areaSlug \|\| null\)/);
  });

  it('outside the same-day zone the header says what is true instead of nothing', () => {
    const c = computeNbaCandidates({ signedIn: false, visits: 2, cart: 0, points: 0, lastOrderDays: null, orderInTransit: false, beforeCutoff: true, minsToCutoff: 90, sunday: false, saleLive: false, deliverTo: { label: 'Mbarara', sameDay: false } });
    expect(c.find((x) => x.id === 'upcountry')?.text).toBe('Delivering to <b>Mbarara</b>? We confirm your delivery day by phone');
    expect(read('apps/web/src/components/GpNav.astro')).toMatch(/id:'upcountry'/);
  });

  it('markup in an area name (it came from a cookie) never reaches the strip as HTML', () => {
    const c = computeNbaCandidates({ signedIn: false, visits: 2, cart: 0, points: 0, lastOrderDays: null, orderInTransit: false, beforeCutoff: true, minsToCutoff: 90, sunday: false, saleLive: false, deliverTo: { label: 'Mb<img src=x>arara', sameDay: false } });
    for (const x of c) expect(x.text).not.toMatch(/<img/);
  });

  it('the popular rail speaks of a place and a crowd, never a person', () => {
    expect(popularNearYouCopy('area', 'Najjera, Wakiso')).toEqual({ title: 'Popular in Najjera', subtitle: 'What Najjera customers have been buying lately.' });
    expect(popularNearYouCopy('greater_kampala', 'Greater Kampala').title).toBe('Popular around Kampala');
    expect(read('apps/web/src/components/recommendations/PopularNearYouRail.astro')).toMatch(/popularNearYouCopy\(scope, scopeLabel/);
  });
});
