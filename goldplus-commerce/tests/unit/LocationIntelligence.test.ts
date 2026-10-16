import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { placeFromPayload, safeBackPath, knownDeliveryPlace, DELIVER_TO_COOKIE } from '../../apps/web/src/lib/deliveryPlace';
import { GUEST_MEMORY_COOKIE } from '../../apps/web/src/lib/guestMemory';
import { plusCodePoint } from '../../apps/web/src/lib/plusCodeInput';
import { computeNbaCandidates } from '../../packages/shared/src/nav/nba';
import { evaluateRule, validateSegmentDefinition, describeRule } from '../../apps/api/src/domain/first-party/Segments';
import { computeCustomerTraits, type TraitInput, type TraitOrder } from '../../apps/api/src/domain/first-party/CustomerTraits';
import type { CustomerFacts } from '../../apps/api/src/domain/first-party/CustomerFacts';
import { isGreaterKampala, isCollectionAreaLine, areaNameOf } from '../../apps/api/src/domain/locations/GreaterKampala';
import { summarisePlaceMemory } from '../../apps/api/src/domain/delivery/PlaceMemory';
import { encode } from '../../packages/shared/src/locations/openLocationCode';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-16T09:00:00Z');
const DAY = 86_400_000;

function cookies(values: Record<string, string>) {
  return { get: (k: string) => (values[k] !== undefined ? { value: values[k] } : undefined) } as never;
}

describe('"Deliver to": the area the customer told us, area only', () => {
  it('keeps the area, drops coordinates, written directions and pickup points', () => {
    const p = placeFromPayload(JSON.stringify({ district: 'Wakiso', area: 'Najjera', areaSlug: 'wakiso-najjera-31338', gpsLat: 0.38, gpsLng: 32.61, displayLabel: 'Najjera, Wakiso' }), 'chosen');
    expect(p).toEqual({ areaSlug: 'wakiso-najjera-31338', district: 'Wakiso', label: 'Najjera, Wakiso', source: 'chosen' });
    expect(JSON.stringify(p)).not.toMatch(/0\.38|32\.61/);
    expect(placeFromPayload({ manual: true, rawAddressText: 'near the mosque', district: 'Gulu' }, 'chosen')).toBeNull();
    expect(placeFromPayload({ pickupPointId: 'x', district: 'Kampala' }, 'chosen')).toBeNull();
    expect(placeFromPayload('not json', 'chosen')).toBeNull();
    expect(placeFromPayload({ district: 'Kampala', areaSlug: '../etc' }, 'chosen')?.areaSlug).toBeNull();
  });

  it('the chosen area wins over the last checkout; with neither there is no place (never inferred from IP)', () => {
    const chosen = encodeURIComponent(JSON.stringify({ district: 'Wakiso', label: 'Kira, Wakiso', areaSlug: 'wakiso-kira-31340' }));
    const memory = encodeURIComponent(JSON.stringify({ locationJson: JSON.stringify({ district: 'Kampala', area: 'Ntinda', displayLabel: 'Ntinda, Kampala' }) }));
    expect(knownDeliveryPlace(cookies({ [DELIVER_TO_COOKIE]: chosen, [GUEST_MEMORY_COOKIE]: memory }))?.label).toBe('Kira, Wakiso');
    expect(knownDeliveryPlace(cookies({ [GUEST_MEMORY_COOKIE]: memory }))).toMatchObject({ label: 'Ntinda, Kampala', source: 'last_checkout' });
    expect(knownDeliveryPlace(cookies({}))).toBeNull();
  });

  it('only returns to a same-site path', () => {
    expect(safeBackPath('/products/gp-l01?x=1')).toBe('/products/gp-l01?x=1');
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', '']) expect(safeBackPath(bad)).toBe('/');
  });

  it('the product page and the cart price for that area; checkout opens with it; an order remembers it', () => {
    const pdp = read('apps/web/src/pages/products/[slug].astro');
    expect(pdp).toMatch(/<DeliverTo place=\{deliverTo\}/);
    expect(pdp).toMatch(/areaSlug=\{deliverTo\?\.areaSlug \?\? null\}/);
    const cart = read('apps/web/src/pages/cart.astro');
    expect(cart).toMatch(/sameDayLineFor\(sameDayCutoffCopy\(/);
    const checkout = read('apps/web/src/pages/checkout.astro');
    expect(checkout).toMatch(/locationJson: guestPrefill\.locationJson \|\| deliverToJson/);
    expect(checkout).toMatch(/if \(orderedTo\) writeChosenPlace\(/);
  });
});

describe('the header names the customer\'s area, and never promises same-day outside it', () => {
  const base = { signedIn: false, visits: 1, cart: 1, points: 0, lastOrderDays: null, orderInTransit: false, beforeCutoff: true, minsToCutoff: 120, sunday: false, saleLive: false, cutoffLabel: '5:00pm' };
  it('in Kampala & Wakiso: the line names their area', () => {
    const c = computeNbaCandidates({ ...base, deliverTo: { label: 'Najjera', sameDay: true } });
    expect(c.find((x) => x.id === 'cart-cutoff')?.text).toMatch(/^Najjera: /);
  });
  it('outside: no same-day line at all', () => {
    const c = computeNbaCandidates({ ...base, deliverTo: { label: 'Mbarara', sameDay: false } });
    expect(c.some((x) => ['cart-cutoff', 'cutoff', 'aftercutoff'].includes(x.id))).toBe(false);
  });
  it('unknown: the general Kampala & Wakiso line, as before', () => {
    const c = computeNbaCandidates(base);
    expect(c.find((x) => x.id === 'cart-cutoff')?.text).toMatch(/^Kampala & Wakiso: /);
  });
  it('the browser copy follows the same rule', () => {
    const nav = read('apps/web/src/components/GpNav.astro');
    expect(nav).toMatch(/data-deliver-sameday=\{navPlaceSameDay\}/);
    expect(nav).toMatch(/var noSameDay = DSD === '0';/);
  });
});

describe('Customer DNA learns the area, from the customer\'s own orders only', () => {
  const order = (p: Partial<TraitOrder>): TraitOrder => ({
    orderId: randomUUID(), placedAt: new Date(NOW.getTime() - 10 * DAY), totalUgx: 50_000, status: 'delivered', paymentStatus: 'paid', paymentMethod: 'offline',
    district: 'Wakiso', area: 'Najjera, Wakiso', collected: false, lines: [], lastClickChannel: null, selfReportedChannel: null, whatsappRef: false, ...p,
  });
  const input = (orders: TraitOrder[]): TraitInput => ({ canonicalCustomerId: randomUUID(), orders, categoryViews: [], devices: [], bulkQuotes: [], addressDistricts: [], optedInChannels: [], finderAnswers: [] });

  it('usual area and how they receive orders', () => {
    const t = computeCustomerTraits(input([
      order({}), order({}), order({ district: 'Kampala', area: 'Ntinda, Kampala' }),
      order({ district: 'Gulu', area: 'Layibi, Gulu' }), order({ collected: true, district: null, area: null }),
    ]), null, NOW);
    expect(t.deliveryArea.value).toBe('Najjera');
    expect(t.deliveryArea.basis).toBe('OBSERVED');
    expect(t.deliveryPattern.value).toEqual({ delivered: 4, collected: 1, areas: 3, greaterKampalaShare: 0.75 });
  });

  it('no orders: null with a reason, never zero', () => {
    const t = computeCustomerTraits(input([]), null, NOW);
    expect(t.deliveryArea.value).toBeNull();
    expect(t.deliveryPattern.value).toBeNull();
  });

  it('segment rules: Greater Kampala, an area, collects', () => {
    const f = (orders: Array<Partial<CustomerFacts['orders'][number]>>): CustomerFacts => ({
      canonicalCustomerId: randomUUID(), accountUserId: null, abandonedBaskets: [], bulkQuotes: [],
      orders: orders.map((o) => ({ orderId: randomUUID(), placedAt: new Date(NOW.getTime() - 5 * DAY), totalUgx: 10_000, status: 'delivered', paymentStatus: 'paid', categoryIds: [], ...o })),
    });
    const mukono = f([{ district: 'Mukono', area: 'Seeta, Mukono' }, { district: 'Mukono', area: 'Seeta, Mukono' }, { district: 'Gulu', area: 'Layibi, Gulu' }]);
    expect(evaluateRule({ kind: 'GREATER_KAMPALA' }, mukono, NOW)).toBe(true);
    expect(evaluateRule({ kind: 'AREA', area: 'seeta' }, mukono, NOW)).toBe(true);
    expect(evaluateRule({ kind: 'COLLECTS' }, mukono, NOW)).toBe(false);
    expect(evaluateRule({ kind: 'COLLECTS' }, f([{ collected: true }]), NOW)).toBe(true);
    expect(evaluateRule({ kind: 'GREATER_KAMPALA' }, f([{ district: 'Gulu' }]), NOW)).toBe(false);
    const parsed = validateSegmentDefinition({ match: 'ALL', rules: [{ kind: 'GREATER_KAMPALA' }, { kind: 'AREA', area: 'Kira' }, { kind: 'COLLECTS' }] });
    expect(parsed.ok).toBe(true);
    expect(describeRule({ kind: 'AREA', area: 'Kira' })).toBe('Most deliveries go to Kira');
  });

  it('Greater Kampala is the gazetteer\'s metro set; collection lines are recognised', () => {
    for (const d of ['Kampala', 'wakiso', 'Mukono', 'Mpigi']) expect(isGreaterKampala(d)).toBe(true);
    expect(isGreaterKampala('Jinja')).toBe(false);
    expect(isCollectionAreaLine('Pickup point: GoldPlus shop, 4th floor')).toBe(true);
    expect(areaNameOf('Najjera, Wakiso')).toBe('Najjera');
  });
});

describe('place memory: what our riders learned here before', () => {
  const at = (d: number) => new Date(NOW.getTime() - d * DAY);
  it('counts deliveries, says how hard it was to find, and offers the last accurate handover point', () => {
    const m = summarisePlaceMemory([
      { orderNumber: 'GP-1', outcome: 'DELIVERED', at: at(30), findDifficulty: 'hard', failedReason: null, handover: { lat: 0.39, lng: 32.61, accuracyM: 20 } },
      { orderNumber: 'GP-2', outcome: 'DELIVERED', at: at(5), findDifficulty: 'easy', failedReason: null, handover: { lat: 0.39, lng: 32.6, accuracyM: 900 } },
      { orderNumber: 'GP-3', outcome: 'FAILED', at: at(6), findDifficulty: null, failedReason: 'Customer not picking calls', handover: null },
    ]);
    expect(m.deliveredBefore).toBe(2);
    expect(m.hardToFind).toBe(1);
    expect(m.handoverPin?.orderNumber).toBe('GP-1'); // the 900 m point is not trusted
    expect(m.riderLine).toMatch(/Delivered here 2 times before/);
    expect(m.riderLine).toMatch(/1 failed attempt \(last: Customer not picking calls\)/);
  });
  it('nothing before: nothing to say', () => {
    expect(summarisePlaceMemory([]).riderLine).toBeNull();
  });
});

describe('Plus Codes the customer gives us become a pin, offline', () => {
  it('our own shop\'s published short code resolves to central Kampala', () => {
    const p = plusCodePoint('8H7H+M5M Kampala');
    expect(p).not.toBeNull();
    expect(Math.abs(p!.lat - 0.3135)).toBeLessThan(0.01);
    expect(Math.abs(p!.lng - 32.5784)).toBeLessThan(0.01);
  });
  it('a full code works anywhere; a short code named for a far place is refused, not guessed', () => {
    const mbarara = encode(-0.6072, 30.6545);
    expect(plusCodePoint(mbarara)).not.toBeNull();
    expect(plusCodePoint(`${mbarara.slice(4)} Mbarara`)).toBeNull();
    expect(plusCodePoint('Najjera near the school')).toBeNull();
  });
});
