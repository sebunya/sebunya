import { describe, it, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSegmentDefinition, evaluateSegment, segmentMembers, describeRule, segmentKeyFromName } from '../../apps/api/src/domain/first-party/Segments';
import { classifyOrder, CustomerFacts } from '../../apps/api/src/domain/first-party/CustomerFacts';
import { customerValue, summariseCustomerValue, cohortRetention, kampalaMonth, median } from '../../apps/api/src/domain/first-party/CustomerValue';
import { hashForAdPlatforms, googleNormalisedEmail } from '../../apps/api/src/domain/first-party/AudienceHashing';
import { ManageSegmentsUseCase, MaterialiseSegmentsUseCase } from '../../apps/api/src/application/use-cases/first-party/SegmentUseCases';
import { SegmentAudienceService } from '../../apps/api/src/application/use-cases/first-party/SegmentAudienceService';
import { GetCustomerValueReportUseCase } from '../../apps/api/src/application/use-cases/first-party/GetCustomerValueReportUseCase';

const DAY = 86_400_000;
const NOW = new Date('2026-09-25T09:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);
const CAT = randomUUID();
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

function customer(p: Partial<CustomerFacts> & { orders?: Array<Partial<CustomerFacts['orders'][number]>> } = {}): CustomerFacts {
  return {
    canonicalCustomerId: p.canonicalCustomerId ?? randomUUID(),
    accountUserId: p.accountUserId ?? null,
    orders: (p.orders ?? []).map((o) => ({ orderId: randomUUID(), placedAt: NOW, totalUgx: 100_000, status: 'delivered', paymentStatus: 'unpaid', categoryIds: [], ...o })),
    abandonedBaskets: p.abandonedBaskets ?? [],
    bulkQuotes: p.bulkQuotes ?? [],
  };
}

describe('orders: counted vs realised', () => {
  it('cancelled/failed are not counted; paid or delivered is realised; an unpaid open order is counted, not realised', () => {
    expect(classifyOrder({ status: 'cancelled', paymentStatus: 'paid' })).toEqual({ counted: false, realised: false });
    expect(classifyOrder({ status: 'processing', paymentStatus: 'paid' })).toEqual({ counted: true, realised: true });
    expect(classifyOrder({ status: 'delivered', paymentStatus: 'unpaid' })).toEqual({ counted: true, realised: true });
    expect(classifyOrder({ status: 'received', paymentStatus: 'unpaid' })).toEqual({ counted: true, realised: false });
  });
});

describe('segment definitions', () => {
  it('accepts the six rule kinds and rejects anything else with a reason', () => {
    const ok = validateSegmentDefinition({ match: 'ANY', rules: [
      { kind: 'BOUGHT_IN_CATEGORY', categoryId: CAT, moreThanDaysAgo: '30' }, { kind: 'ABANDONED_BASKET', withinDays: 7 },
      { kind: 'LIFETIME_SPEND_AT_LEAST', amountUgx: 1_000_000 }, { kind: 'BULK_BUYER' }, { kind: 'REPEAT_BUYER' }, { kind: 'LAPSED', noOrderForDays: 120 },
    ] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.definition.rules.find((r) => r.kind === 'REPEAT_BUYER')).toEqual({ kind: 'REPEAT_BUYER', minOrders: 2 });
    const bad = validateSegmentDefinition({ rules: [{ kind: 'NAME_LOOKS_LIKE' }, { kind: 'ABANDONED_BASKET', withinDays: 0 }, { kind: 'BOUGHT_IN_CATEGORY', categoryId: 'x', moreThanDaysAgo: 3 }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(3);
    expect(validateSegmentDefinition({ rules: [] }).ok).toBe(false);
    expect(validateSegmentDefinition({ rules: new Array(9).fill({ kind: 'BULK_BUYER' }) }).ok).toBe(false);
  });

  it('describes rules in words and makes a stable key from a name', () => {
    expect(describeRule({ kind: 'ABANDONED_BASKET', withinDays: 7 })).toBe('Left a basket in the last 7 days');
    expect(describeRule({ kind: 'BOUGHT_IN_CATEGORY', categoryId: CAT, moreThanDaysAgo: 30 }, () => 'Power banks')).toMatch(/Power banks/);
    expect(segmentKeyFromName('  High value (UGX 1m+) ')).toBe('high-value-ugx-1m');
    expect(segmentKeyFromName('!!')).toBeNull();
  });
});

describe('segment rules evaluate against real facts only', () => {
  const def = (rules: any[], match: 'ALL' | 'ANY' = 'ALL') => {
    const v = validateSegmentDefinition({ match, rules });
    if (!v.ok) throw new Error(v.errors.join());
    return v.definition;
  };

  it('bought in category X more than N days ago', () => {
    const d = def([{ kind: 'BOUGHT_IN_CATEGORY', categoryId: CAT, moreThanDaysAgo: 30 }]);
    expect(evaluateSegment(d, customer({ orders: [{ placedAt: ago(40), categoryIds: [CAT] }] }), NOW)).toBe(true);
    expect(evaluateSegment(d, customer({ orders: [{ placedAt: ago(10), categoryIds: [CAT] }] }), NOW)).toBe(false);
    expect(evaluateSegment(d, customer({ orders: [{ placedAt: ago(40), categoryIds: [CAT], status: 'cancelled' }] }), NOW)).toBe(false);
  });

  it('abandoned a basket in the last 7 days', () => {
    const d = def([{ kind: 'ABANDONED_BASKET', withinDays: 7 }]);
    expect(evaluateSegment(d, customer({ abandonedBaskets: [{ cartId: 'c', updatedAt: ago(3), itemCount: 2 }] }), NOW)).toBe(true);
    expect(evaluateSegment(d, customer({ abandonedBaskets: [{ cartId: 'c', updatedAt: ago(9), itemCount: 2 }] }), NOW)).toBe(false);
    expect(evaluateSegment(d, customer({ abandonedBaskets: [{ cartId: 'c', updatedAt: ago(1), itemCount: 0 }] }), NOW)).toBe(false);
  });

  it('high value counts realised spend only', () => {
    const d = def([{ kind: 'LIFETIME_SPEND_AT_LEAST', amountUgx: 500_000 }]);
    expect(evaluateSegment(d, customer({ orders: [{ totalUgx: 300_000 }, { totalUgx: 300_000, paymentStatus: 'paid', status: 'processing' }] }), NOW)).toBe(true);
    expect(evaluateSegment(d, customer({ orders: [{ totalUgx: 900_000, status: 'received' }] }), NOW)).toBe(false);
  });

  it('bulk buyer, repeat buyer, lapsed, and ALL vs ANY', () => {
    expect(evaluateSegment(def([{ kind: 'BULK_BUYER' }]), customer({ bulkQuotes: [{ reference: 'BQ-7K3M9P', createdAt: ago(2) }] }), NOW)).toBe(true);
    expect(evaluateSegment(def([{ kind: 'REPEAT_BUYER' }]), customer({ orders: [{}, { status: 'failed' }] }), NOW)).toBe(false);
    expect(evaluateSegment(def([{ kind: 'REPEAT_BUYER' }]), customer({ orders: [{}, {}] }), NOW)).toBe(true);
    const lapsed = def([{ kind: 'LAPSED', noOrderForDays: 90 }]);
    expect(evaluateSegment(lapsed, customer({ orders: [{ placedAt: ago(100) }] }), NOW)).toBe(true);
    expect(evaluateSegment(lapsed, customer({ orders: [] }), NOW)).toBe(false);
    const both = [{ kind: 'BULK_BUYER' }, { kind: 'REPEAT_BUYER' }];
    const oneOnly = customer({ bulkQuotes: [{ reference: 'BQ-AAAAAA', createdAt: NOW }] });
    expect(evaluateSegment(def(both, 'ALL'), oneOnly, NOW)).toBe(false);
    expect(evaluateSegment(def(both, 'ANY'), oneOnly, NOW)).toBe(true);
  });
});

// ── Fakes for the application layer ──────────────────────────────────────────
function segmentStore() {
  const segs = new Map<string, any>();
  const members = new Map<string, Map<string, Date>>();
  const runs: any[] = [];
  return {
    segs, members, runs,
    async list(all: boolean) { return [...segs.values()].filter((s) => all || s.status === 'ACTIVE'); },
    async findById(id: string) { return segs.get(id) ?? null; },
    async findByKey(k: string) { return [...segs.values()].find((s) => s.key === k) ?? null; },
    async create(i: any) { const s = { id: randomUUID(), status: 'ACTIVE', memberCount: null, lastMaterialisedAt: null, createdAt: NOW, updatedAt: NOW, ...i }; segs.set(s.id, s); return s; },
    async update(id: string, i: any) { const s = segs.get(id); if (!s) return null; Object.assign(s, i, { memberCount: null, lastMaterialisedAt: null }); return s; },
    async setStatus(id: string, status: string) { const s = segs.get(id); if (!s) return false; s.status = status; return true; },
    async replaceMembers(id: string, _run: string, ids: string[], at: Date) {
      const cur = members.get(id) ?? new Map();
      const next = new Map<string, Date>();
      let added = 0;
      for (const c of ids) { if (cur.has(c)) next.set(c, cur.get(c)!); else { next.set(c, at); added++; } }
      const removed = [...cur.keys()].filter((c) => !next.has(c)).length;
      members.set(id, next);
      Object.assign(segs.get(id), { memberCount: ids.length, lastMaterialisedAt: at });
      return { added, removed, total: ids.length };
    },
    async listMembers(id: string, limit: number, after?: string | null) {
      return [...(members.get(id) ?? new Map()).entries()].map(([c, d]) => ({ canonicalCustomerId: c, firstMatchedAt: d })).sort((a, b) => (a.canonicalCustomerId < b.canonicalCustomerId ? -1 : 1)).filter((m) => !after || m.canonicalCustomerId > after).slice(0, limit);
    },
    async startRun(trigger: string) { const r = { id: randomUUID(), trigger, status: 'RUNNING' }; runs.push(r); return r.id; },
    async finishRun(id: string, i: any) { Object.assign(runs.find((r) => r.id === id), i); },
    async listRuns() { return runs; },
    async lastCompletedRunAt() { return runs.some((r) => r.status === 'COMPLETE') ? NOW : null; },
  };
}
const audit = () => { const saved: any[] = []; return { saved, async save(l: any) { saved.push(l); }, async findAll() { return saved; }, async findByEntity() { return []; } }; };

describe('segments engine — admin use cases and nightly materialisation', () => {
  it('creates (audited), previews without storing, and refuses a bad definition', async () => {
    const store = segmentStore();
    const a = audit();
    const facts = [customer({ orders: [{}, {}] }), customer({ orders: [{}] })];
    const uc = new ManageSegmentsUseCase(store as any, { readAll: async () => facts, listCategories: async () => [] }, a as any);
    const created = await uc.create({ name: 'Repeat buyers', definition: { rules: [{ kind: 'REPEAT_BUYER' }] }, actorId: randomUUID() });
    expect(created.ok).toBe(true);
    expect(a.saved.map((s) => s.action)).toContain('CUSTOMER_SEGMENT_CREATED');
    expect((await uc.create({ name: 'Repeat buyers', definition: { rules: [{ kind: 'REPEAT_BUYER' }] }, actorId: randomUUID() }))).toMatchObject({ ok: false, code: 'DUPLICATE' });
    expect(await uc.create({ name: 'Broken', definition: { rules: [{ kind: 'X' }] }, actorId: randomUUID() })).toMatchObject({ ok: false, code: 'BAD_DEFINITION' });
    const preview = await uc.preview({ rules: [{ kind: 'REPEAT_BUYER' }] }, NOW);
    expect(preview).toMatchObject({ ok: true, count: 1, customersEvaluated: 2 });
    if (preview.ok) expect(preview.sample[0]).toMatch(/^[0-9a-f]{8}…$/);
    expect(store.members.size).toBe(0);
    // A fresh segment has NO count yet — not zero.
    const listed = await uc.list();
    expect(listed[0].memberCount).toBeNull();
  });

  it('the nightly run links unlinked orders first, then materialises; members diff by run', async () => {
    const store = segmentStore();
    const c1 = customer({ orders: [{}, {}] });
    let facts = [c1];
    const stitched: string[] = [];
    const seg = await store.create({ key: 'repeat', name: 'Repeat', description: null, definition: { match: 'ALL', rules: [{ kind: 'REPEAT_BUYER', minOrders: 2 }] }, actorId: 'x' });
    const uc = new MaterialiseSegmentsUseCase(store as any, { readAll: async () => facts, listCategories: async () => [] },
      { listUnlinkedOrders: async () => [{ orderId: randomUUID(), userId: null, customerEmail: null, customerPhone: '0772123456', profileId: null, fpClientId: null }] },
      { execute: async (i: any) => { stitched.push(i.moment); return { canonicalCustomerId: randomUUID() } as any; } } as any);
    const r1 = await uc.execute({ trigger: 'schedule', now: NOW });
    expect(r1.status).toBe('COMPLETE');
    expect(stitched).toEqual(['BACKFILL']);
    expect(r1.ordersStitched).toBe(1);
    expect(r1.segments[0]).toMatchObject({ id: seg.id, total: 1, added: 1, removed: 0 });
    facts = [];
    const r2 = await uc.execute({ trigger: 'schedule', now: NOW });
    expect(r2.segments[0]).toMatchObject({ total: 0, removed: 1 });
    expect(store.segs.get(seg.id).memberCount).toBe(0);
  });

  it('a failed run is recorded as FAILED, never as an empty success', async () => {
    const store = segmentStore();
    await store.create({ key: 'x', name: 'X', description: null, definition: { match: 'ALL', rules: [{ kind: 'BULK_BUYER' }] }, actorId: 'x' });
    const uc = new MaterialiseSegmentsUseCase(store as any, { readAll: async () => { throw new Error('CUSTOMER_FACTS_INPUT_EXCEEDS_BOUND'); }, listCategories: async () => [] },
      { listUnlinkedOrders: async () => [] }, { execute: async () => ({}) } as any);
    const r = await uc.execute({ trigger: 'admin', now: NOW });
    expect(r.status).toBe('FAILED');
    expect(store.runs[0].status).toBe('FAILED');
    expect([...store.segs.values()][0].memberCount).toBeNull();
  });
});

describe('segment → audience port applies consent per member', () => {
  async function setup() {
    const store = segmentStore();
    const seg = await store.create({ key: 's', name: 'S', description: null, definition: { match: 'ALL', rules: [{ kind: 'BULK_BUYER' }] }, actorId: 'x' });
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()].sort();
    await store.replaceMembers(seg.id, 'run', ids, NOW);
    const contacts = {
      async contactsFor(list: string[]) {
        return list.map((id, i) => ({
          canonicalCustomerId: id,
          accountUserId: i === 3 ? null : `00000000-0000-4000-8000-00000000000${i}`,
          email: i === 2 ? null : `User.${i}@Gmail.com`,
          phone: i === 2 ? null : '0772123456',
          fpClientIds: i === 1 ? ['fp.1.refused'] : [],
        }));
      },
    };
    const advertising = {
      async refusedMany(subjects: Array<{ key: string; fpClientIds: string[] }>) { return new Set(subjects.filter((w) => w.fpClientIds.includes('fp.1.refused')).map((w) => w.key)); },
    };
    const whatsapp = { async mayMarket(uid: string) { return uid.endsWith('0') ? { allowed: true, reason: 'OPTED_IN', phoneE164: '+256772123456' } : { allowed: false, reason: 'NOT_OPTED_IN', phoneE164: null }; } };
    return { store, seg, ids, service: new SegmentAudienceService(store as any, contacts as any, advertising as any, whatsapp as any) };
  }

  it('advertising: refusals and members without an identifier are excluded; only hashes leave', async () => {
    const { seg, service } = await setup();
    const r = await service.advertisingAudience(seg.id);
    expect(r.status).toBe('OK');
    expect(r.excludedAdvertisingRefused).toBe(1);
    expect(r.excludedNoIdentifier).toBe(1);
    expect(r.members).toHaveLength(2);
    const json = JSON.stringify(r.members);
    expect(json).not.toMatch(/gmail|0772|256772/i);
    expect(r.members[0].hashed.phoneSha256E164).toBe(sha('+256772123456'));
    expect(r.members[0].hashed.phoneSha256Digits).toBe(sha('256772123456'));
  });

  it('an unreadable consent answer excludes the member (never sent on an unknown)', async () => {
    const { store, seg } = await setup();
    const svc = new SegmentAudienceService(store as any, { async contactsFor(l: string[]) { return l.map((id) => ({ canonicalCustomerId: id, accountUserId: null, email: 'a@b.co', phone: null, fpClientIds: [] })); } } as any,
      { async refusedMany() { throw new Error('db'); } } as any, { async mayMarket() { return { allowed: false, reason: 'x', phoneE164: null }; } } as any);
    const r = await svc.advertisingAudience(seg.id);
    expect(r.members).toHaveLength(0);
    expect(r.excludedConsentUnknown).toBe(4);
  });

  it('WhatsApp messaging: only opted-in account holders; guests cannot have opted in', async () => {
    const { seg, service } = await setup();
    const r = await service.messagingAudience(seg.id, 'whatsapp');
    expect(r.members).toHaveLength(1);
    expect(r.members[0].phoneE164).toBe('+256772123456');
    expect(r.excludedGuest).toBe(1);
    expect(r.excludedNotOptedIn).toBe(2);
  });

  it('says NOT_MATERIALISED / SEGMENT_NOT_FOUND rather than an empty audience', async () => {
    const store = segmentStore();
    const seg = await store.create({ key: 'n', name: 'N', description: null, definition: { match: 'ALL', rules: [{ kind: 'BULK_BUYER' }] }, actorId: 'x' });
    const svc = new SegmentAudienceService(store as any, {} as any, {} as any, {} as any);
    expect((await svc.advertisingAudience(seg.id)).status).toBe('NOT_MATERIALISED');
    expect((await svc.advertisingAudience(randomUUID())).status).toBe('SEGMENT_NOT_FOUND');
  });
});

describe('ad-platform hashing follows each platform\'s documented normalisation', () => {
  it('Google gmail rules; digits-only vs E.164 phone; lowercase trimmed email', () => {
    expect(googleNormalisedEmail('jane.doe+shopping@googlemail.com')).toBe('janedoe@googlemail.com');
    expect(googleNormalisedEmail('jane.doe+x@example.com')).toBe('jane.doe+x@example.com');
    const h = hashForAdPlatforms({ email: ' Jane.Doe@Gmail.com ', phone: '0772 123456' });
    expect(h.emailSha256).toBe(sha('jane.doe@gmail.com'));
    expect(h.emailSha256Google).toBe(sha('janedoe@gmail.com'));
    expect(h.phoneSha256E164).toBe(sha('+256772123456'));
    expect(h.phoneSha256Digits).toBe(sha('256772123456'));
    expect(hashForAdPlatforms({ email: 'nope', phone: '12' })).toEqual({ emailSha256: null, emailSha256Google: null, phoneSha256E164: null, phoneSha256Digits: null });
  });
});

describe('LTV and repeat purchase — honest empty states', () => {
  it('per-customer value, order count and time to second order', () => {
    const c = customer({ orders: [{ placedAt: ago(40), totalUgx: 200_000, status: 'delivered' }, { placedAt: ago(10), totalUgx: 50_000, status: 'received' }, { placedAt: ago(5), status: 'cancelled' }] });
    const v = customerValue(c)!;
    expect(v.orderCount).toBe(2);
    expect(v.realisedOrderCount).toBe(1);
    expect(v.lifetimeValueUgx).toBe(200_000);
    expect(v.placedValueUgx).toBe(250_000);
    expect(v.daysToSecondOrder).toBe(30);
    expect(customerValue(customer({ orders: [{ status: 'cancelled' }] }))).toBeNull();
  });

  it('a summary over nobody is null, never 0%', () => {
    expect(summariseCustomerValue([])).toMatchObject({ customers: 0, repeatRate: null, averageLifetimeValueUgx: null, medianDaysToSecondOrder: null });
    const s = summariseCustomerValue([customerValue(customer({ orders: [{ status: 'received' }] }))!]);
    expect(s.repeatRate).toBe(0);
    expect(s.averageLifetimeValueUgx).toBeNull();
    expect(median([1, 2, 3, 10])).toBe(3);
  });

  it('cohort retention by first-order month in Kampala time; future months are null', () => {
    expect(kampalaMonth(new Date('2026-08-31T22:30:00Z'))).toBe('2026-09');
    const a = customer({ orders: [{ placedAt: new Date('2026-07-05T10:00:00Z') }, { placedAt: new Date('2026-09-02T10:00:00Z') }] });
    const b = customer({ orders: [{ placedAt: new Date('2026-07-20T10:00:00Z') }] });
    const [cohort] = cohortRetention([a, b], NOW, 3);
    expect(cohort.cohortMonth).toBe('2026-07');
    expect(cohort.size).toBe(2);
    expect(cohort.retention).toEqual([1, 0, 0.5, null]);
    expect(cohort.active).toEqual([2, 0, 1, null]);
  });

  it('the report says NO_DATA with nothing linked, and reports identity coverage', async () => {
    const uc = new GetCustomerValueReportUseCase({ readAll: async () => [], listCategories: async () => [] }, segmentStore() as any, { orderLinkCoverage: async () => ({ orders: 18, linkedOrders: 0 }) });
    const r = await uc.execute({ now: NOW });
    expect(r.status).toBe('NO_DATA');
    expect(r.identityCoverage).toEqual({ orders: 18, linkedOrders: 0, share: 0 });
    expect(r.summary.repeatRate).toBeNull();
    const none = await new GetCustomerValueReportUseCase({ readAll: async () => [], listCategories: async () => [] }, segmentStore() as any, { orderLinkCoverage: async () => ({ orders: 0, linkedOrders: 0 }) }).execute({ now: NOW });
    expect(none.identityCoverage.share).toBeNull();
  });
});

describe('admin surfaces say "No data", never 0%', () => {
  const root = resolve(__dirname, '../..');
  it('customer value and segments pages', () => {
    const value = readFileSync(resolve(root, 'apps/web/src/pages/admin/customer-value.astro'), 'utf8');
    expect(value).toMatch(/const NO_DATA = "No data"/);
    expect(value).toMatch(/typeof n === "number" \? `\$\{Math\.round\(n \* 1000\) \/ 10\}%` : NO_DATA/);
    const segs = readFileSync(resolve(root, 'apps/web/src/pages/admin/segments.astro'), 'utf8');
    expect(segs).toMatch(/Not yet calculated/);
    for (const src of [value, segs]) expect(src).not.toMatch(/\son[a-z]+=/);
  });
});
