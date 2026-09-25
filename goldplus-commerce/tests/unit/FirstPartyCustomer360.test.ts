import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  computeCustomerTraits, guessDevices, paymentHabitOf, rfmForPopulation, valueOf, type TraitInput, type TraitOrder,
} from '../../apps/api/src/domain/first-party/CustomerTraits';
import { buildCustomerTimeline, describeLink, maskKey, type Customer360Records } from '../../apps/api/src/domain/first-party/Customer360';
import { GetCustomer360UseCase } from '../../apps/api/src/application/use-cases/first-party/Customer360UseCases';
import type { CustomerFacts } from '../../apps/api/src/domain/first-party/CustomerFacts';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const DAY = 86_400_000;
const NOW = new Date('2026-09-25T09:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

function order(p: Partial<TraitOrder> = {}): TraitOrder {
  return {
    orderId: randomUUID(), placedAt: ago(10), totalUgx: 100_000, status: 'delivered', paymentStatus: 'unpaid', paymentMethod: 'offline',
    district: 'Kampala', lines: [], lastClickChannel: null, selfReportedChannel: null, whatsappRef: false, ...p,
  };
}
function input(p: Partial<TraitInput> = {}): TraitInput {
  return { canonicalCustomerId: randomUUID(), orders: [], categoryViews: [], devices: [], bulkQuotes: [], addressDistricts: [], optedInChannels: [], finderAnswers: [], ...p };
}
function facts(id: string, orders: Array<{ placedAt: Date; totalUgx: number; status?: string; paymentStatus?: string }>): CustomerFacts {
  return {
    canonicalCustomerId: id, accountUserId: null, abandonedBaskets: [], bulkQuotes: [],
    orders: orders.map((o) => ({ orderId: randomUUID(), categoryIds: [], status: 'delivered', paymentStatus: 'paid', ...o })),
  };
}

describe('traits: every value says how it was obtained, and no evidence is never a number', () => {
  it('a customer with nothing recorded has null traits with reasons, not zeros', () => {
    const t = computeCustomerTraits(input(), null, NOW);
    for (const trait of [t.rfm, t.categoryAffinity, t.brandAffinity, t.categoriesBrowsed, t.deviceOwned, t.preferredChannel, t.paymentHabit, t.district, t.statedNeeds]) {
      expect(trait.value, trait.key).toBeNull();
      expect(trait.evidence.length, trait.key).toBeGreaterThan(5);
    }
    expect(t.rfm.evidence).toMatch(/No order yet/);
    expect(t.bulkBuyer.value).toBe(false);
    expect(t.marketingOptIns.value).toBeNull();
  });

  it('the phone owned is ALWAYS an estimate, never an observed fact', () => {
    const t = computeCustomerTraits(input({ devices: [{ deviceId: null, label: 'Tecno Spark 10', source: 'BATTERY_REQUEST', at: ago(3) }] }), null, NOW);
    expect(t.deviceOwned.basis).toBe('ESTIMATE');
    expect(t.deviceOwned.label).toMatch(/estimate/i);
    expect(t.deviceOwned.value?.[0]).toMatchObject({ label: 'Tecno Spark 10', confidence: 'LIKELY' });
    // nothing else is labelled an estimate: the rest are recorded, calculated or declared
    const bases = Object.values(t).filter((x) => x.key !== 'device_owned').map((x) => x.basis);
    expect(bases).not.toContain('ESTIMATE');
  });

  it('battery purchases: one listed phone is LIKELY, a battery that fits several is only POSSIBLE', () => {
    const guesses = guessDevices([
      { deviceId: 'a', label: 'Itel A60', source: 'BATTERY_PURCHASE', at: ago(5), fitsDevices: 1 },
      { deviceId: 'b', label: 'Tecno Pop 7', source: 'BATTERY_PURCHASE', at: ago(5), fitsDevices: 3 },
      { deviceId: 'c', label: 'Tecno Pop 8', source: 'BATTERY_PURCHASE', at: ago(5), fitsDevices: 3 },
    ]);
    expect(guesses.find((g) => g.label === 'Itel A60')?.confidence).toBe('LIKELY');
    expect(guesses.find((g) => g.label === 'Tecno Pop 7')).toMatchObject({ confidence: 'POSSIBLE', evidence: ['bought a battery listed for this phone and 2 others'] });
    expect(guesses[0].label).toBe('Itel A60'); // likely first
  });

  it('payment habit needs two thirds one way; unknown methods do not count', () => {
    expect(paymentHabitOf(['offline', 'offline', 'pesapal'])?.habit).toBe('CASH_ON_DELIVERY');
    expect(paymentHabitOf(['pesapal', 'pesapal', 'offline'])?.habit).toBe('ONLINE');
    expect(paymentHabitOf(['pesapal', 'offline'])?.habit).toBe('MIXED');
    expect(paymentHabitOf([null, null])).toBeNull();
  });

  it('affinity is share of spend over counted orders; cancelled orders do not count; brands only when recorded', () => {
    const cat = (name: string, total: number, brand: string | null = null) => ({ productId: randomUUID(), categoryId: null, categoryName: name, brand, quantity: 1, lineTotalUgx: total });
    const t = computeCustomerTraits(input({
      orders: [
        order({ lines: [cat('Power', 300_000, 'Oraimo'), cat('Audio', 100_000)] }),
        order({ status: 'cancelled', lines: [cat('Storage', 5_000_000, 'Sandisk')] }),
      ],
    }), null, NOW);
    expect(t.categoryAffinity.value).toEqual([{ name: 'Power', share: 0.75 }, { name: 'Audio', share: 0.25 }]);
    expect(t.brandAffinity.value).toEqual([{ name: 'Oraimo', share: 1 }]);
    expect(t.categoryAffinity.basis).toBe('DERIVED');
  });

  it('district: recorded deliveries first, the saved address only as a declared fallback', () => {
    const recorded = computeCustomerTraits(input({ orders: [order({ district: 'Wakiso' }), order({ district: 'Wakiso' }), order({ district: 'Kampala' })], addressDistricts: ['Mukono'] }), null, NOW);
    expect(recorded.district).toMatchObject({ value: 'Wakiso', basis: 'OBSERVED' });
    const declared = computeCustomerTraits(input({ addressDistricts: ['Mukono'] }), null, NOW);
    expect(declared.district).toMatchObject({ value: 'Mukono', basis: 'DECLARED' });
  });

  it('preferred channel: last click, else their own answer, else a WhatsApp reference', () => {
    const t = computeCustomerTraits(input({ orders: [order({ lastClickChannel: 'paid_social' }), order({ selfReportedChannel: 'whatsapp' }), order({ whatsappRef: true })] }), null, NOW);
    expect(t.preferredChannel.value).toEqual({ channel: 'whatsapp', orders: 2, of: 3 });
  });

  it('bulk buyer, opt-ins and product-finder answers', () => {
    const t = computeCustomerTraits(input({
      bulkQuotes: [{ reference: 'BQ-ABC123', createdAt: ago(2), lineCount: 3, totalUnits: 40 }],
      optedInChannels: ['whatsapp'],
      finderAnswers: [{ at: ago(30), answers: { category: 'Storage' } }, { at: ago(1), answers: { category: 'Power', budget: 'Mid-range' } }],
    }), null, NOW);
    expect(t.bulkBuyer).toMatchObject({ value: true, basis: 'OBSERVED' });
    expect(t.marketingOptIns).toMatchObject({ value: ['whatsapp'], basis: 'DECLARED' });
    expect(t.statedNeeds).toMatchObject({ value: { category: 'Power', budget: 'Mid-range' }, basis: 'DECLARED' });
  });

  it('RFM is scored against customers who have ordered; someone with no order has none', () => {
    const a = randomUUID(); const b = randomUUID(); const c = randomUUID(); const none = randomUUID();
    const map = rfmForPopulation([
      facts(a, [{ placedAt: ago(2), totalUgx: 900_000 }, { placedAt: ago(20), totalUgx: 900_000 }, { placedAt: ago(40), totalUgx: 900_000 }]),
      facts(b, [{ placedAt: ago(200), totalUgx: 50_000 }]),
      facts(c, [{ placedAt: ago(60), totalUgx: 200_000 }]),
      facts(none, []),
    ], NOW);
    expect(map.has(none)).toBe(false);
    expect(map.get(a)).toMatchObject({ r: 5, f: 5, m: 5, segment: 'Champions', population: 3 });
    expect(map.get(b)?.segment).toBe('Lost');
    const t = computeCustomerTraits(input(), map.get(a)!, NOW);
    expect(t.rfm.value).toMatchObject({ code: '555', population: 3 });
  });

  it('value: nothing counted is null, never 0', () => {
    expect(valueOf([])).toMatchObject({ orderCount: 0, lifetimeValueUgx: null, averageOrderValueUgx: null, daysToSecondOrder: null });
    const v = valueOf([order({ placedAt: ago(30), totalUgx: 200_000, paymentStatus: 'paid', status: 'processing' }), order({ placedAt: ago(10), totalUgx: 100_000, status: 'received' })]);
    expect(v).toMatchObject({ orderCount: 2, realisedOrderCount: 1, lifetimeValueUgx: 200_000, averageOrderValueUgx: 200_000, daysToSecondOrder: 20 });
  });
});

function records(p: Partial<Customer360Records> = {}): Customer360Records {
  return {
    profile: { canonicalCustomerId: randomUUID(), accountUserId: null, identityConfidence: 'MEDIUM', lifecycleStage: 'ACTIVE', createdAt: ago(100), mergedInto: null },
    account: null, links: [], foldedProfiles: 0, openConflicts: 0, orders: [], carts: [], quotes: [], loyalty: null, support: [], messages: [],
    visits: [], categoryViews: [], lastSeenAt: null, consents: { tracking: [], purposes: [] }, attribution: [], selfReported: [],
    devices: [], addressDistricts: [], segments: [], privacyRequests: [], finderSessions: [], ...p,
  };
}

describe('timeline and identity display', () => {
  it('newest first, every event a recorded row, capped at 200', () => {
    const r = records({
      orders: Array.from({ length: 150 }, (_, i) => ({ ...order({ placedAt: ago(i) }), orderNumber: `GP-${i}`, contactName: null, contactPhone: null, contactEmail: null })),
      visits: Array.from({ length: 100 }, (_, i) => ({ at: ago(i + 0.5), channel: 'organic_search', source: 'google', landingPath: '/shop' })),
    });
    const t = buildCustomerTimeline(r);
    expect(t).toHaveLength(200);
    expect(t[0].title).toMatch(/^Order GP-0 · UGX 100,000/);
    for (let i = 1; i < t.length; i++) expect(Date.parse(t[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(t[i].at));
  });

  it('identifier keys are masked and described, never shown whole', () => {
    expect(maskKey('a'.repeat(64))).toBe('aaaa…aaaa');
    expect(maskKey('short')).toBe('••••');
    expect(describeLink('STABLE_ANONYMOUS_ID', 'fp:fp.1.x')).toBe('Browser id');
    expect(describeLink('ORDER_CUSTOMER_RELATIONSHIP', 'order:x')).toBe('Order');
    expect(describeLink('CONTACT_PHONE', 'abc')).toBe('Phone (typed)');
  });
});

describe('Customer 360 use case: every view is audited first', () => {
  const audits: any[] = [];
  const auditRepo = { async save(l: any) { audits.push(l); }, async findAll() { return []; }, async findByEntity() { return []; } };
  const failingAudit = { async save() { throw new Error('audit table down'); }, async findAll() { return []; }, async findByEntity() { return []; } };

  it('writes CUSTOMER_PROFILE_VIEWED before returning data, masks keys, and keeps only BQ- quotes as bulk', async () => {
    const id = randomUUID();
    const viewer = randomUUID();
    const r = records({
      profile: { canonicalCustomerId: id, accountUserId: null, identityConfidence: 'MEDIUM', lifecycleStage: 'NEW_CUSTOMER', createdAt: ago(5), mergedInto: null },
      links: [{ signalType: 'CONTACT_PHONE', status: 'ACTIVE', confidence: 'MEDIUM', identifierKey: 'f'.repeat(64), createdAt: ago(5) }],
      quotes: [
        { reference: null, createdAt: ago(3), status: 'new', lineCount: null, totalUnits: null, estimatedTotalUgx: null, lines: [] },
        { reference: 'BQ-XYZ234', createdAt: ago(2), status: 'new', lineCount: 2, totalUnits: 20, estimatedTotalUgx: 500_000, lines: [] },
      ],
      orders: [{ ...order(), orderNumber: 'GP-1', contactName: 'Jane', contactPhone: '0772000000', contactEmail: null }],
    });
    let readBeforeAudit = 0;
    const reader = { async read() { readBeforeAudit = audits.length; return r; }, async canonicalForAccount() { return null; } };
    const factsReader = { async readAll() { return [facts(id, [{ placedAt: ago(10), totalUgx: 100_000 }])]; }, async listCategories() { return []; } };
    const uc = new GetCustomer360UseCase(reader as any, factsReader as any, auditRepo as any);
    const before = audits.length;
    const out = await uc.execute({ canonicalCustomerId: id, viewerId: viewer, now: NOW });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(audits.length).toBe(before + 1);
    expect(readBeforeAudit).toBe(before);
    expect(audits.at(-1)).toMatchObject({ action: 'CUSTOMER_PROFILE_VIEWED', entity: 'customer_profile', entityId: id, actorId: viewer });
    expect(JSON.stringify(out)).not.toContain('f'.repeat(64));
    expect(out.identity.links[0].identifierMasked).toBe('ffff…ffff');
    expect(out.traits.bulkBuyer.value).toBe(true);
    expect(out.traits.bulkBuyer.evidence).toMatch(/1 bulk quote request/);
    expect(out.identity.guestContacts).toEqual([{ name: 'Jane', phone: '0772000000', email: null }]);
    expect(out.traits.rfm.value?.population).toBe(1);
  });

  it('if the audit row cannot be written, NOTHING is shown', async () => {
    const reader = { async read() { return records(); }, async canonicalForAccount() { return null; } };
    const uc = new GetCustomer360UseCase(reader as any, { async readAll() { return []; }, async listCategories() { return []; } } as any, failingAudit as any);
    const out = await uc.execute({ canonicalCustomerId: randomUUID(), viewerId: randomUUID() });
    expect(out).toEqual({ ok: false, code: 'AUDIT_UNAVAILABLE', message: expect.stringMatching(/could not be recorded/) });
    expect(await uc.recordView({ canonicalCustomerId: randomUUID(), viewerId: randomUUID(), surface: 'customer_dna' })).toBe(false);
  });

  it('an unreadable RFM population says so instead of guessing; unknown or malformed ids are not found', async () => {
    const reader = { async read(id: string) { return id === 'x' ? null : records(); }, async canonicalForAccount() { return null; } };
    const uc = new GetCustomer360UseCase(reader as any, { async readAll() { throw new Error('too big'); }, async listCategories() { return []; } } as any, auditRepo as any);
    const out = await uc.execute({ canonicalCustomerId: randomUUID(), viewerId: randomUUID() });
    expect(out.ok && out.traits.rfm).toMatchObject({ value: null, evidence: expect.stringMatching(/could not be read/) });
    expect((await uc.execute({ canonicalCustomerId: 'x', viewerId: 'v' })).ok).toBe(false);
  });
});

describe('Customer 360 wiring', () => {
  it('the 360 route needs customer_data.view; the DNA detail is audited too', () => {
    const fp = read('apps/api/src/interfaces/http/routes/admin/first-party.ts');
    expect(fp).toMatch(/'\/customers\/:id\/360', requirePermissions\(\[PERMISSIONS\.CUSTOMER_DATA_VIEW\]\)/);
    expect(fp).toMatch(/'\/customers\/by-account\/:userId', requirePermissions\(\[PERMISSIONS\.CUSTOMER_DATA_VIEW\]\)/);
    const dna = read('apps/api/src/interfaces/http/routes/admin/customer-dna.ts');
    expect(dna).toMatch(/getCustomer360UseCase\.recordView/);
    expect(dna).toMatch(/AUDIT_UNAVAILABLE/);
  });

  it('behaviour is read only through behaviour links; our own exhaust is excluded; supplier cost is never read', () => {
    const src = read('apps/api/src/infrastructure/first-party/DrizzleCustomer360Reader.ts');
    expect(src).toMatch(/traffic_class = 'customer'/);
    expect(src).toMatch(/analysis\.traffic_exclusion_marks/);
    expect(src).toMatch(/personalisationRefused/);
    expect(src).not.toMatch(/cogs_snapshot/);
  });

  it('the admin page exists, is session-guarded and labels estimates', () => {
    const page = read('apps/web/src/pages/admin/customer-360/[id].astro');
    expect(page).toContain('readSessionToken(Astro.request)');
    expect(page).toMatch(/Astro\.redirect\([\s\S]*?, 303\)/);
    expect(page).toMatch(/ESTIMATE: \{ label: "Estimate"/);
    expect(page).toMatch(/recorded in the audit log/);
    expect(page).not.toMatch(/\son[a-z]+=/);
  });
});
