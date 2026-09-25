/**
 * Customer traits computed from behaviour (0157, docs/first-party/README.md).
 * Pure: the Customer 360 reader supplies the records; nothing here touches a
 * database or a clock.
 *
 * Honesty rules, each load-bearing:
 * - Every trait carries its BASIS: OBSERVED (a recorded fact), DERIVED
 *   (arithmetic over recorded facts), DECLARED (the customer told us) or
 *   ESTIMATE (a guess from indirect evidence). The admin page labels an
 *   ESTIMATE as an estimate; nothing predicted is ever shown as fact.
 * - No evidence = value null with the reason, never 0, never a default.
 * - RFM quintiles are relative to the customers who have ordered (the
 *   population), never fixed thresholds; a customer with no order has no RFM.
 */
import { scoreRfm, type RfmScore } from '../customer-dna/Rfm';
import { CustomerFacts, classifyOrder, countedOrders, realisedSpendUgx } from './CustomerFacts';

export type TraitBasis = 'OBSERVED' | 'DERIVED' | 'DECLARED' | 'ESTIMATE';

export interface Trait<T> {
  key: string;
  label: string;
  /** null = no evidence; `evidence` says why. */
  value: T | null;
  basis: TraitBasis;
  evidence: string;
}

export interface TraitOrderLine {
  productId: string;
  categoryId: string | null;
  categoryName: string | null;
  brand: string | null;
  quantity: number;
  lineTotalUgx: number;
}

export interface TraitOrder {
  orderId: string;
  placedAt: Date;
  totalUgx: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  district: string | null;
  lines: TraitOrderLine[];
  /** The channel the attribution module credited (last click), when recorded. */
  lastClickChannel: string | null;
  /** "How did you hear about us?" as the customer answered it, when answered. */
  selfReportedChannel: string | null;
  /** The order carried a WhatsApp click-to-chat reference code. */
  whatsappRef: boolean;
}

export type DeviceEvidenceSource = 'BATTERY_PURCHASE' | 'BATTERY_REQUEST';

export interface DeviceEvidence {
  deviceId: string | null;
  label: string;
  source: DeviceEvidenceSource;
  at: Date;
  /** BATTERY_PURCHASE: how many phones the bought battery is listed for. */
  fitsDevices?: number;
}

export interface TraitInput {
  canonicalCustomerId: string;
  orders: TraitOrder[];
  /** Categories viewed by this customer's linked visitor ids (human traffic only). */
  categoryViews: Array<{ categoryId: string | null; categoryName: string | null }>;
  devices: DeviceEvidence[];
  bulkQuotes: Array<{ reference: string; createdAt: Date; lineCount: number | null; totalUnits: number | null }>;
  /** Districts on the account's saved addresses (default first). */
  addressDistricts: string[];
  /** Marketing channels the customer switched ON themselves. */
  optedInChannels: string[];
  /** Product-finder answers (category, problem, priority, budget), newest session first. */
  finderAnswers: Array<{ at: Date; answers: Record<string, string> }>;
}

export interface AffinityItem { name: string; share: number; }
export interface DeviceGuess { label: string; confidence: 'LIKELY' | 'POSSIBLE'; evidence: string[]; }
export interface PaymentHabit { habit: 'CASH_ON_DELIVERY' | 'ONLINE' | 'MIXED'; cashOnDelivery: number; online: number; }
export interface RfmTrait { r: number; f: number; m: number; code: string; segment: string; recencyDays: number | null; population: number; }

export interface CustomerTraits {
  rfm: Trait<RfmTrait>;
  categoryAffinity: Trait<AffinityItem[]>;
  categoriesBrowsed: Trait<AffinityItem[]>;
  brandAffinity: Trait<AffinityItem[]>;
  deviceOwned: Trait<DeviceGuess[]>;
  preferredChannel: Trait<{ channel: string; orders: number; of: number }>;
  paymentHabit: Trait<PaymentHabit>;
  district: Trait<string>;
  bulkBuyer: Trait<boolean>;
  marketingOptIns: Trait<string[]>;
  statedNeeds: Trait<Record<string, string>>;
}

const DAY_MS = 86_400_000;

/** RFM for every customer with a counted order, relative to that population. */
export function rfmForPopulation(facts: CustomerFacts[], now: Date): Map<string, RfmScore & { population: number }> {
  const inputs = facts
    .map((f) => {
      const orders = countedOrders(f);
      if (orders.length === 0) return null;
      return { customerId: f.canonicalCustomerId, lastOrderAt: orders[orders.length - 1].placedAt, orderCount: orders.length, totalSpendUgx: realisedSpendUgx(f) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const scores = scoreRfm(inputs, now);
  return new Map(scores.map((s) => [s.customerId, { ...s, population: inputs.length }]));
}

function shares(weights: Map<string, number>, top = 3): AffinityItem[] {
  const total = [...weights.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([name, w]) => ({ name, share: Math.round((w / total) * 1000) / 1000 }));
}

function mode(values: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? { value: best[0], count: best[1] } : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** COD = 'offline' at checkout; online = 'pesapal'. Two-thirds decides a habit. */
export function paymentHabitOf(methods: Array<string | null>): PaymentHabit | null {
  const cod = methods.filter((m) => m === 'offline').length;
  const online = methods.filter((m) => m === 'pesapal').length;
  const known = cod + online;
  if (known === 0) return null;
  const habit = cod / known >= 2 / 3 ? 'CASH_ON_DELIVERY' : online / known >= 2 / 3 ? 'ONLINE' : 'MIXED';
  return { habit, cashOnDelivery: cod, online };
}

/**
 * The phone a customer probably owns. Always an ESTIMATE:
 * - LIKELY: they asked us for a battery for that phone, or bought a battery
 *   listed for exactly one phone;
 * - POSSIBLE: a bought battery fits several phones.
 * A battery bought for someone else is indistinguishable, hence never a fact.
 */
export function guessDevices(evidence: DeviceEvidence[]): DeviceGuess[] {
  const byLabel = new Map<string, { confidence: 'LIKELY' | 'POSSIBLE'; evidence: string[] }>();
  for (const e of evidence) {
    const label = e.label.trim();
    if (!label) continue;
    const likely = e.source === 'BATTERY_REQUEST' || (e.source === 'BATTERY_PURCHASE' && (e.fitsDevices ?? 0) === 1);
    const others = Math.max(0, (e.fitsDevices ?? 1) - 1);
    const why = e.source === 'BATTERY_REQUEST' ? 'asked for a battery for this phone'
      : others === 0 ? 'bought a battery listed only for this phone'
        : `bought a battery listed for this phone and ${others} other${others === 1 ? '' : 's'}`;
    const entry: { confidence: 'LIKELY' | 'POSSIBLE'; evidence: string[] } = byLabel.get(label) ?? { confidence: 'POSSIBLE', evidence: [] };
    if (likely) entry.confidence = 'LIKELY';
    if (!entry.evidence.includes(why)) entry.evidence.push(why);
    byLabel.set(label, entry);
  }
  return [...byLabel.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => (a.confidence === b.confidence ? a.label.localeCompare(b.label) : a.confidence === 'LIKELY' ? -1 : 1))
    .slice(0, 5);
}

export function computeCustomerTraits(input: TraitInput, rfm: (RfmScore & { population: number }) | null, _now: Date): CustomerTraits {
  const counted = input.orders.filter((o) => classifyOrder(o).counted);

  const rfmTrait: Trait<RfmTrait> = rfm
    ? {
      key: 'rfm', label: 'RFM score', basis: 'DERIVED',
      value: { r: rfm.r, f: rfm.f, m: rfm.m, code: rfm.rfm, segment: rfm.segment, recencyDays: rfm.recencyDays, population: rfm.population },
      evidence: `Recency, order count and paid spend, scored 1–5 against ${plural(rfm.population, 'customer')} who have ordered.`,
    }
    : { key: 'rfm', label: 'RFM score', basis: 'DERIVED', value: null, evidence: 'No order yet, so no RFM score.' };

  const catSpend = new Map<string, number>();
  const brandSpend = new Map<string, number>();
  let lines = 0;
  let brandLines = 0;
  for (const o of counted) {
    for (const l of o.lines) {
      lines++;
      const weight = l.lineTotalUgx > 0 ? l.lineTotalUgx : l.quantity;
      const cat = l.categoryName ?? l.categoryId;
      if (cat) catSpend.set(cat, (catSpend.get(cat) ?? 0) + weight);
      if (l.brand && l.brand.trim()) {
        brandLines++;
        const b = l.brand.trim();
        brandSpend.set(b, (brandSpend.get(b) ?? 0) + weight);
      }
    }
  }
  const categoryAffinity: Trait<AffinityItem[]> = lines
    ? { key: 'category_affinity', label: 'Categories bought', basis: 'DERIVED', value: shares(catSpend), evidence: `Share of spend across ${plural(lines, 'order line')}.` }
    : { key: 'category_affinity', label: 'Categories bought', basis: 'DERIVED', value: null, evidence: 'No order lines yet.' };
  const brandAffinity: Trait<AffinityItem[]> = brandLines
    ? { key: 'brand_affinity', label: 'Brands bought', basis: 'DERIVED', value: shares(brandSpend), evidence: `Share of spend across ${plural(brandLines, 'order line')} whose product names a brand.` }
    : { key: 'brand_affinity', label: 'Brands bought', basis: 'DERIVED', value: null, evidence: lines ? 'The products bought do not record a brand.' : 'No order lines yet.' };

  const viewCounts = new Map<string, number>();
  for (const v of input.categoryViews) {
    const name = v.categoryName ?? v.categoryId;
    if (name) viewCounts.set(name, (viewCounts.get(name) ?? 0) + 1);
  }
  const viewed = [...viewCounts.values()].reduce((s, n) => s + n, 0);
  const categoriesBrowsed: Trait<AffinityItem[]> = viewed
    ? { key: 'categories_browsed', label: 'Categories browsed', basis: 'OBSERVED', value: shares(viewCounts), evidence: `${plural(viewed, 'product or category view')} on this customer's linked browsers (our own traffic excluded).` }
    : { key: 'categories_browsed', label: 'Categories browsed', basis: 'OBSERVED', value: null, evidence: 'No browsing linked to this customer.' };

  const devices = guessDevices(input.devices);
  const deviceOwned: Trait<DeviceGuess[]> = devices.length
    ? { key: 'device_owned', label: 'Phone owned (estimate)', basis: 'ESTIMATE', value: devices, evidence: 'Estimated from battery requests and battery purchases. A battery may be bought for someone else.' }
    : { key: 'device_owned', label: 'Phone owned (estimate)', basis: 'ESTIMATE', value: null, evidence: 'No battery request or battery purchase with a listed phone is linked to this customer.' };

  const channels = counted
    .map((o) => o.lastClickChannel ?? o.selfReportedChannel ?? (o.whatsappRef ? 'whatsapp' : null))
    .filter((c): c is string => !!c);
  const top = mode(channels);
  const preferredChannel: Trait<{ channel: string; orders: number; of: number }> = top
    ? { key: 'preferred_channel', label: 'How their orders came', basis: 'DERIVED', value: { channel: top.value, orders: top.count, of: counted.length }, evidence: `Most common recorded source across ${plural(channels.length, 'order')} with one (last click, else their own answer, else a WhatsApp reference).` }
    : { key: 'preferred_channel', label: 'How their orders came', basis: 'DERIVED', value: null, evidence: counted.length ? 'No order has a recorded source.' : 'No order yet.' };

  const habit = paymentHabitOf(counted.map((o) => o.paymentMethod));
  const paymentHabit: Trait<PaymentHabit> = habit
    ? { key: 'payment_habit', label: 'Payment habit', basis: 'DERIVED', value: habit, evidence: `${plural(habit.cashOnDelivery, 'order')} cash on delivery, ${habit.online} online. Two thirds or more one way sets the habit.` }
    : { key: 'payment_habit', label: 'Payment habit', basis: 'DERIVED', value: null, evidence: counted.length ? 'No order records how it was paid.' : 'No order yet.' };

  const orderDistricts = counted.map((o) => o.district?.trim()).filter((d): d is string => !!d);
  const d = mode(orderDistricts);
  const district: Trait<string> = d
    ? { key: 'district', label: 'District', basis: 'OBSERVED', value: d.value, evidence: `Delivery district on ${d.count} of ${plural(orderDistricts.length, 'order')} with one.` }
    : input.addressDistricts[0]
      ? { key: 'district', label: 'District', basis: 'DECLARED', value: input.addressDistricts[0], evidence: 'From the customer\'s saved address (no delivered order records one).' }
      : { key: 'district', label: 'District', basis: 'OBSERVED', value: null, evidence: 'No order or saved address records a district.' };

  const bulkBuyer: Trait<boolean> = {
    key: 'bulk_buyer', label: 'Bulk buyer', basis: 'OBSERVED',
    value: input.bulkQuotes.length > 0,
    evidence: input.bulkQuotes.length
      ? `${plural(input.bulkQuotes.length, 'bulk quote request')} linked by their contact details.`
      : 'No bulk quote request linked to this customer.',
  };

  const marketingOptIns: Trait<string[]> = {
    key: 'marketing_opt_ins', label: 'Offers they switched on', basis: 'DECLARED',
    value: input.optedInChannels.length ? [...input.optedInChannels].sort() : null,
    evidence: input.optedInChannels.length ? 'Recorded in the preference centre with evidence.' : 'None switched on. Offers stay off until the customer turns them on.',
  };

  const latestFinder = [...input.finderAnswers].sort((a, b) => b.at.getTime() - a.at.getTime()).find((f) => Object.keys(f.answers).length > 0);
  const statedNeeds: Trait<Record<string, string>> = latestFinder
    ? { key: 'stated_needs', label: 'What they told the product finder', basis: 'DECLARED', value: latestFinder.answers, evidence: `Their answers in the product finder on ${latestFinder.at.toISOString().slice(0, 10)}.` }
    : { key: 'stated_needs', label: 'What they told the product finder', basis: 'DECLARED', value: null, evidence: 'No product-finder answers linked to this customer.' };

  return { rfm: rfmTrait, categoryAffinity, categoriesBrowsed, brandAffinity, deviceOwned, preferredChannel, paymentHabit, district, bulkBuyer, marketingOptIns, statedNeeds };
}

/** Value numbers for the 360 header. null = not computable, never 0. */
export function valueOf(orders: Array<Pick<TraitOrder, 'placedAt' | 'totalUgx' | 'status' | 'paymentStatus'>>) {
  const counted = orders.filter((o) => classifyOrder(o).counted).sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());
  const realised = counted.filter((o) => classifyOrder(o).realised);
  const ltv = realised.reduce((s, o) => s + o.totalUgx, 0);
  return {
    orderCount: counted.length,
    realisedOrderCount: realised.length,
    lifetimeValueUgx: realised.length ? ltv : null,
    placedValueUgx: counted.length ? counted.reduce((s, o) => s + o.totalUgx, 0) : null,
    averageOrderValueUgx: realised.length ? Math.round(ltv / realised.length) : null,
    firstOrderAt: counted[0]?.placedAt ?? null,
    lastOrderAt: counted[counted.length - 1]?.placedAt ?? null,
    daysToSecondOrder: counted.length >= 2 ? Math.floor((counted[1].placedAt.getTime() - counted[0].placedAt.getTime()) / DAY_MS) : null,
  };
}
