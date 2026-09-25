import { describe, it, expect } from 'vitest';
import {
  HEARD_ABOUT_ANSWERS,
  HEARD_ABOUT_OPTIONS,
  normaliseWhatsAppRef,
  parseHeardAbout,
  WHATSAPP_REF_ALPHABET,
  WHATSAPP_REF_PATTERN,
} from '../../packages/shared/src/attribution/heardAbout';
import {
  buildWeeklyChannelReport,
  channelReportCsvRows,
  codeTouchFrom,
  countsAsSale,
  creditOrder,
  declaredChannel,
  goodsValueUGX,
  journeyFor,
  JOURNEY_MODELS,
  MODEL_LABELS,
  parseReportModel,
  REPORT_MODELS,
  reportChannelForSpend,
  reportWeeks,
  weeksRange,
  weekStartKampala,
  type ObservedTouch,
} from '../../apps/api/src/domain/measurement/ChannelReport';
import {
  AttributeOrderUseCase,
  BackfillOrderAttributionUseCase,
  effectiveDeclared,
  GetOrderAttributionUseCase,
  GetWeeklyChannelReportUseCase,
  RecordCheckoutAttributionUseCase,
  RecordOrderSourceUseCase,
} from '../../apps/api/src/application/use-cases/measurement/ChannelAttributionUseCases';
import type { ChannelAttributionStore, OrderAttributionFacts, SaleFacts } from '../../apps/api/src/application/ports/measurement/ChannelAttribution';
import { CollectBrowserBatchUseCase, type BatchReceipt, type CollectorStore } from '../../apps/api/src/application/use-cases/telemetry/CollectBrowserBatchUseCase';
import { newWhatsAppRef, tagWhatsAppHref, WA_REF_ALPHABET } from '../../apps/web/src/lib/whatsappRef';
import { CHANNEL_REPORT_MODELS, formatOrders, sparklinePoints, weekLabel } from '../../apps/web/src/lib/channelReport';

const day = 86_400_000;
const orderAt = new Date('2026-09-24T12:00:00Z');
const touch = (id: string, channel: string, daysBefore: number, detail = ''): ObservedTouch => ({ touchId: id, channel, detail, at: new Date(orderAt.getTime() - daysBefore * day) });
const sumCredits = (cs: Array<{ creditedUGX: bigint }>) => cs.reduce((s, c) => s + c.creditedUGX, 0n);

describe('self-reported source and WhatsApp reference (shared)', () => {
  it('accepts only the closed answer list; unknown answers are dropped, not guessed', () => {
    expect(parseHeardAbout('facebook')).toBe('facebook');
    expect(parseHeardAbout(' TikTok ')).toBe('tiktok');
    expect(parseHeardAbout('billboard')).toBeNull();
    expect(parseHeardAbout('')).toBeNull();
    expect(parseHeardAbout(undefined)).toBeNull();
    expect(HEARD_ABOUT_OPTIONS.map((o) => o.value)).toEqual([...HEARD_ABOUT_ANSWERS]);
  });
  it('normalises what staff paste from a chat to GP-XXXXXX, and refuses anything else', () => {
    expect(normaliseWhatsAppRef('Ref GP-7K3Q9X')).toBe('GP-7K3Q9X');
    expect(normaliseWhatsAppRef('gp 7k3q9x')).toBe('GP-7K3Q9X');
    expect(normaliseWhatsAppRef('7K3Q9X')).toBe('GP-7K3Q9X');
    // A bare code may itself start with "GP".
    expect(normaliseWhatsAppRef('GPAB23')).toBe('GP-GPAB23');
    expect(normaliseWhatsAppRef('GP-7K3Q9')).toBeNull();
    expect(normaliseWhatsAppRef('GP-7K3Q0X')).toBeNull(); // 0 is not in the alphabet
    expect(normaliseWhatsAppRef(42)).toBeNull();
  });
  it('the storefront generator uses the same alphabet as the server pattern', () => {
    expect(WA_REF_ALPHABET).toBe(WHATSAPP_REF_ALPHABET);
    for (let i = 0; i < 50; i++) expect(newWhatsAppRef()).toMatch(WHATSAPP_REF_PATTERN);
  });
  it('rejection sampling: bytes 240..255 are skipped so every character is equally likely', () => {
    const bytes = [255, 240, 0, 1, 2, 3, 4, 29, 30, 239, 0, 0];
    const code = newWhatsAppRef(() => Uint8Array.from(bytes));
    expect(code).toBe(`GP-${'2345'}${WA_REF_ALPHABET[4]}${WA_REF_ALPHABET[29]}`);
  });
});

describe('WhatsApp link tagging (storefront)', () => {
  it('adds a visible, percent-encoded Ref line to a chat with our number', () => {
    const r = tagWhatsAppHref('https://wa.me/256700000000?text=Hello%20GoldPlus', 'GP-7K3Q9X')!;
    expect(r.fresh).toBe(true);
    expect(r.href).toBe('https://wa.me/256700000000?text=Hello%20GoldPlus%0A%0ARef%20GP-7K3Q9X');
    expect(new URL(r.href).searchParams.get('text')).toBe('Hello GoldPlus\n\nRef GP-7K3Q9X');
  });
  it('keeps the code already in the link (a second tap is the same chat)', () => {
    const once = tagWhatsAppHref('https://wa.me/256700000000', 'GP-7K3Q9X')!;
    const twice = tagWhatsAppHref(once.href, 'GP-AAAAAA')!;
    expect(twice).toEqual({ href: once.href, code: 'GP-7K3Q9X', fresh: false });
  });
  it('tags api.whatsapp.com/send?phone= and leaves share links and garbage alone', () => {
    expect(tagWhatsAppHref('https://api.whatsapp.com/send?phone=256700000000&text=Hi', 'GP-7K3Q9X')?.href)
      .toBe('https://api.whatsapp.com/send?phone=256700000000&text=Hi%0A%0ARef%20GP-7K3Q9X');
    expect(tagWhatsAppHref('https://wa.me/?text=Use%20my%20code', 'GP-7K3Q9X')).toBeNull();
    expect(tagWhatsAppHref('not a url', 'GP-7K3Q9X')).toBeNull();
  });
});

describe('journeys', () => {
  it('keeps touches inside the 30-day window, oldest first, one per consecutive channel', () => {
    const j = journeyFor({ orderAt, code: null, declared: null, observed: [
      touch('c', 'direct', 1), touch('a', 'paid_social', 40), touch('b', 'paid_social', 10, 'facebook'), touch('b2', 'paid_social', 9), touch('d', 'direct', -1),
    ] });
    expect(j.basis).toBe('observed');
    expect(j.steps.map((s) => s.channel)).toEqual(['paid_social', 'direct']);
    expect(j.steps[0].detail).toBe('facebook');
  });
  it('a creator or promo code is the final touch, at the moment of the order', () => {
    const j = journeyFor({ orderAt, observed: [touch('a', 'organic_search', 3)], code: { kind: 'creator', detail: 'amina' }, declared: 'facebook' });
    expect(j.steps.map((s) => [s.channel, s.detail])).toEqual([['organic_search', ''], ['creator', 'amina']]);
    expect(j.steps[1].at).toEqual(orderAt);
  });
  it('the customer\'s answer is used only when nothing was observed, and is marked declared', () => {
    expect(journeyFor({ orderAt, observed: [], code: null, declared: 'friend' })).toEqual({ steps: [{ channel: 'word_of_mouth', detail: '', at: orderAt }], basis: 'declared' });
    expect(journeyFor({ orderAt, observed: [], code: null, declared: null })).toEqual({ steps: [], basis: null });
  });
  it('ambiguous answers stay ambiguous (Facebook is not paid social)', () => {
    expect(declaredChannel('facebook')).toEqual({ channel: 'social_declared', detail: 'facebook' });
    expect(declaredChannel('search').channel).toBe('search_declared');
  });
});

describe('per-order credit under each model', () => {
  const observed = [touch('1', 'paid_social', 20), touch('2', 'organic_search', 10), touch('3', 'direct', 1)];
  const credits = creditOrder({ orderAt, observed, code: null, declared: 'tiktok' }, 100_001n);
  const byModel = (m: string) => credits.filter((c) => c.model === m);

  it('every model credits exactly the order value — no shilling created or lost', () => {
    for (const m of JOURNEY_MODELS) expect(sumCredits(byModel(m))).toBe(100_001n);
    expect(sumCredits(byModel('self_reported'))).toBe(100_001n);
  });
  it('last click, first touch, linear, position-based and time decay', () => {
    expect(byModel('last_click').map((c) => c.channel)).toEqual(['direct']);
    expect(byModel('first_touch').map((c) => c.channel)).toEqual(['paid_social']);
    expect(byModel('linear').map((c) => c.weight.toFixed(4))).toEqual(['0.3333', '0.3333', '0.3333']);
    const pb = Object.fromEntries(byModel('position_based').map((c) => [c.channel, c.weight]));
    expect(pb.paid_social).toBeCloseTo(0.4); expect(pb.direct).toBeCloseTo(0.4); expect(pb.organic_search).toBeCloseTo(0.2);
    const td = Object.fromEntries(byModel('time_decay').map((c) => [c.channel, c.weight]));
    expect(td.direct).toBeGreaterThan(td.organic_search); expect(td.organic_search).toBeGreaterThan(td.paid_social);
  });
  it('self-reported is its own model and the observed journey wins the others', () => {
    expect(byModel('self_reported')).toEqual([{ model: 'self_reported', channel: 'social_declared', detail: 'tiktok', weight: 1, creditedUGX: 100_001n, basis: 'declared' }]);
    expect(credits.filter((c) => c.model !== 'self_reported').every((c) => c.basis === 'observed')).toBe(true);
  });
  it('an order with no evidence has no credit at all (the report files it as No recorded source)', () => {
    expect(creditOrder({ orderAt, observed: [], code: null, declared: null }, 50_000n)).toEqual([]);
  });
  it('a promo code alone credits the code under every journey model', () => {
    const cs = creditOrder({ orderAt, observed: [], code: { kind: 'promo_code', detail: 'SEPT10' }, declared: null }, 70_000n);
    expect(cs.map((c) => `${c.model}:${c.channel}:${c.detail}`)).toEqual(JOURNEY_MODELS.map((m) => `${m}:promo_code:SEPT10`));
  });
  it('which code counts: a creator (attribution or code) beats a plain promo; a batch of codes is one campaign', () => {
    expect(codeTouchFrom({ attributed_handle: 'amina', code: 'X1' })).toEqual({ kind: 'creator', detail: 'amina' });
    expect(codeTouchFrom({ creator_handle: 'joel', code: 'JOEL5' })).toEqual({ kind: 'creator', detail: 'joel' });
    expect(codeTouchFrom({ code: 'sept10', code_type: 'public' })).toEqual({ kind: 'promo_code', detail: 'SEPT10' });
    expect(codeTouchFrom({ code: 'K9X2', code_type: 'bulk_batch', promotion_name: 'Back to school' })).toEqual({ kind: 'promo_code', detail: 'Back to school' });
    expect(codeTouchFrom({})).toBeNull();
    expect(codeTouchFrom(undefined)).toBeNull();
  });
});

describe('what counts as a sale, and its value', () => {
  it('excludes cancelled, failed, refunded and unpaid online orders; pay-on-delivery counts', () => {
    expect(countsAsSale({ status: 'received', paymentStatus: 'unpaid', paymentMethod: 'offline' })).toBe(true);
    expect(countsAsSale({ status: 'processing', paymentStatus: 'paid', paymentMethod: 'pesapal' })).toBe(true);
    expect(countsAsSale({ status: 'pending_payment', paymentStatus: 'unpaid', paymentMethod: 'pesapal' })).toBe(false);
    expect(countsAsSale({ status: 'cancelled', paymentStatus: 'unpaid', paymentMethod: 'offline' })).toBe(false);
    expect(countsAsSale({ status: 'delivery_failed', paymentStatus: 'unpaid', paymentMethod: 'offline' })).toBe(false);
    expect(countsAsSale({ status: 'completed', paymentStatus: 'refunded', paymentMethod: 'pesapal' })).toBe(false);
  });
  it('revenue is the goods, without the delivery fee', () => {
    expect(goodsValueUGX(160_000, 10_000)).toBe(150_000n);
    expect(goodsValueUGX(5_000, 10_000)).toBe(0n);
  });
});

describe('Kampala weeks', () => {
  it('a week starts Monday 00:00 in Kampala (UTC+3)', () => {
    expect(weekStartKampala(new Date('2026-09-20T21:30:00Z'))).toBe('2026-09-21'); // Mon 00:30 EAT
    expect(weekStartKampala(new Date('2026-09-20T20:59:00Z'))).toBe('2026-09-14'); // Sun 23:59 EAT
    expect(weekStartKampala(new Date('2026-09-27T12:00:00Z'))).toBe('2026-09-21'); // Sunday
  });
  it('lists the last N weeks oldest first and the instant range they cover', () => {
    const w = reportWeeks(new Date('2026-09-24T12:00:00Z'), 3);
    expect(w).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
    const r = weeksRange(w);
    expect(r.from.toISOString()).toBe('2026-09-06T21:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-27T21:00:00.000Z');
    expect(reportWeeks(new Date(), 500)).toHaveLength(52);
  });
});

describe('spend channel mapping', () => {
  it('files spend where its clicks land: every Google Ads click carries a gclid (paid search)', () => {
    expect(reportChannelForSpend('paid_display', 'google_ads')).toBe('paid_search');
    expect(reportChannelForSpend('paid_pmax', 'Google Ads')).toBe('paid_search');
    expect(reportChannelForSpend('paid_social', 'meta')).toBe('paid_social');
    expect(reportChannelForSpend('paid_other', 'TikTok')).toBe('paid_social');
    expect(reportChannelForSpend('paid_display', 'opera')).toBe('display');
    expect(reportChannelForSpend('paid_other', 'boomplay')).toBe('other_paid');
  });
});

describe('weekly channel report', () => {
  const weeks = ['2026-09-14', '2026-09-21'];
  const sales = [
    { orderId: 'o1', orderAt: new Date('2026-09-15T09:00:00Z'), revenueUGX: 100_000n },
    { orderId: 'o2', orderAt: new Date('2026-09-22T09:00:00Z'), revenueUGX: 300_000n },
    { orderId: 'o3', orderAt: new Date('2026-09-23T09:00:00Z'), revenueUGX: 50_000n },
  ];
  const credits = [
    { orderId: 'o1', channel: 'paid_social', detail: 'facebook', weight: 1, creditedUGX: 100_000n, basis: 'observed' as const },
    { orderId: 'o2', channel: 'creator', detail: 'amina', weight: 0.5, creditedUGX: 150_000n, basis: 'observed' as const },
    { orderId: 'o2', channel: 'paid_social', detail: '', weight: 0.5, creditedUGX: 150_000n, basis: 'observed' as const },
    { orderId: 'gone', channel: 'paid_social', detail: '', weight: 1, creditedUGX: 999n, basis: 'observed' as const }, // cancelled: not a sale here
  ];

  it('no spend source: every spend, ROAS and cost-per-order is empty, never zero', () => {
    const r = buildWeeklyChannelReport({ model: 'linear', weeks, sales, credits, spend: { status: 'NOT_AVAILABLE' } });
    expect(r.spendStatus).toBe('NOT_AVAILABLE');
    expect(r.channels.every((c) => c.spendUGX === null && c.roas === null && c.costPerOrderUGX === null)).toBe(true);
    expect(r.totals).toMatchObject({ orders: 3, revenueUGX: '450000', spendUGX: null, roas: null, costPerOrderUGX: null });
    const ps = r.channels.find((c) => c.channel === 'paid_social')!;
    expect(ps).toMatchObject({ orders: 1.5, revenueUGX: '250000' });
    expect(ps.trend.map((t) => t.revenueUGX)).toEqual(['100000', '150000']);
  });
  it('a sale with no evidence is its own "No recorded source" row, last, and totals still add up', () => {
    const r = buildWeeklyChannelReport({ model: 'last_click', weeks, sales, credits, spend: { status: 'NOT_AVAILABLE' } });
    const last = r.channels[r.channels.length - 1];
    expect(last).toMatchObject({ channel: 'unattributed', label: 'No recorded source', orders: 1, revenueUGX: '50000' });
    expect(r.channels.reduce((s, c) => s + BigInt(c.revenueUGX), 0n)).toBe(450_000n);
    expect(r.weekly.map((w) => w.orders)).toEqual([1, 2]);
  });
  it('with spend: ROAS and cost per order; a channel with spend and no sale still shows', () => {
    const r = buildWeeklyChannelReport({ model: 'linear', weeks, sales, credits, spend: { status: 'AVAILABLE', rows: [
      { weekStart: '2026-09-21', channel: 'paid_social', spendUGX: 50_000n },
      { weekStart: '2026-09-14', channel: 'paid_social', spendUGX: 50_000n },
      { weekStart: '2026-09-21', channel: 'paid_search', spendUGX: 20_000n },
      { weekStart: '2026-08-01', channel: 'paid_search', spendUGX: 1n }, // outside the weeks
    ] } });
    const ps = r.channels.find((c) => c.channel === 'paid_social')!;
    expect(ps).toMatchObject({ spendUGX: '100000', roas: 2.5, costPerOrderUGX: '66667' });
    expect(r.channels.find((c) => c.channel === 'paid_search')).toMatchObject({ orders: 0, revenueUGX: '0', spendUGX: '20000', roas: 0, costPerOrderUGX: null });
    expect(r.channels.find((c) => c.channel === 'creator')).toMatchObject({ spendUGX: null, roas: null });
    expect(r.totals).toMatchObject({ spendUGX: '120000', roas: 3.75, costPerOrderUGX: '40000' });
    expect(r.creatorsAndCodes).toEqual([{ channel: 'creator', detail: 'amina', orders: 0.5, revenueUGX: '150000' }]);
  });
  it('nothing in the weeks: empty, and the CSV says No data instead of zeros', () => {
    const r = buildWeeklyChannelReport({ model: 'first_touch', weeks, sales: [], credits: [], spend: { status: 'NOT_AVAILABLE' } });
    expect(r.empty).toBe(true);
    expect(channelReportCsvRows(r)).toEqual([
      ['model', 'week_start', 'channel', 'channel_label', 'credited_orders', 'revenue_ugx', 'spend_ugx', 'roas', 'cost_per_order_ugx'],
      ['first_touch', '', '', 'No data', '', '', '', '', ''],
    ]);
  });
  it('CSV rows per channel-week, with "No spend data" where there is no spend source', () => {
    const r = buildWeeklyChannelReport({ model: 'last_click', weeks, sales, credits, spend: { status: 'NOT_AVAILABLE' } });
    const rows = channelReportCsvRows(r);
    expect(rows[0][0]).toBe('model');
    expect(rows.slice(1).every((x) => x[6] === 'No spend data' && x[7] === 'No data')).toBe(true);
    expect(rows.some((x) => x[1] === '2026-09-15')).toBe(false);
  });
});

describe('model list', () => {
  it('the admin switcher offers exactly the domain models with the same labels', () => {
    expect(CHANNEL_REPORT_MODELS.map((m) => m.value)).toEqual([...REPORT_MODELS]);
    for (const m of CHANNEL_REPORT_MODELS) expect(m.label).toBe(MODEL_LABELS[m.value as keyof typeof MODEL_LABELS].label);
    expect(parseReportModel('shapley')).toBe('last_click');
    expect(parseReportModel('linear')).toBe('linear');
  });
  it('view helpers: a flat-zero trend is not drawn; shared sales show one decimal', () => {
    expect(sparklinePoints([0, 0, 0], 120, 28)).toBeNull();
    expect(sparklinePoints([0, 10], 120, 28)).toBe('0,26 120,2');
    expect(formatOrders(3)).toBe('3');
    expect(formatOrders(1.5)).toBe('1.5');
    expect(weekLabel('2026-09-21')).toMatch(/^21 Sep\S* 2026$/);
    expect(weekLabel('not-a-date')).toBe('not-a-date');
  });
});

// ── Use cases against an in-memory store ──────────────────────────────────────
function memoryStore(seed: Partial<OrderAttributionFacts> = {}) {
  const order: OrderAttributionFacts = {
    orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 'GP-1001', orderAt, status: 'received', paymentStatus: 'unpaid', paymentMethod: 'offline',
    totalUGX: 160_000, deliveryFeeUGX: 10_000, visitorId: 'fp.1.visitor', observed: [], code: null, reports: [], ...seed,
  };
  const touchesByVisitor = new Map<string, ObservedTouch[]>([
    ['fp.1.visitor', [touch('t1', 'paid_social', 5, 'facebook')]],
    ['fp.2.whatsapp', [touch('t2', 'organic_search', 12, 'google')]],
  ]);
  const refs = new Map([['GP-7K3Q9X', { visitorId: 'fp.2.whatsapp', issuedAt: orderAt }]]);
  const saved: any[] = [];
  const links: Array<{ visitorId: string; method: string }> = [];
  let sales: SaleFacts[] = [];
  const store: ChannelAttributionStore = {
    loadOrder: async (id) => (id === order.orderId ? structuredClone(order) : null),
    linkVisitorTouches: async ({ visitorId, method }) => {
      links.push({ visitorId, method });
      const fresh = (touchesByVisitor.get(visitorId) ?? []).filter((t) => !order.observed.some((o) => o.touchId === t.touchId));
      order.observed.push(...fresh);
      return fresh.length;
    },
    replaceCredits: async (id, credits) => { saved.length = 0; saved.push(...credits.map((c) => ({ ...c, orderId: id }))); },
    recordSourceReport: async (r) => { order.reports.unshift({ reportedBy: r.reportedBy, answer: r.answer as any, whatsappRef: r.whatsappRef, note: r.note, createdAt: new Date() }); },
    findWhatsAppRef: async (code) => refs.get(code) ?? null,
    orderIdsPlacedBetween: async (_f, _t, limit) => [order.orderId, 'broken'].slice(0, limit),
    salesBetween: async () => sales,
    creditsBetween: async (model) => saved.filter((c) => c.model === model),
    creditsForOrder: async () => saved.map((c) => ({ ...c, computedAt: orderAt })),
  };
  return { store, order, saved, links, setSales: (s: SaleFacts[]) => { sales = s; } };
}

describe('attribution use cases', () => {
  it('links the order\'s visitor touches and credits every model from the goods value', async () => {
    const m = memoryStore();
    const r = await new AttributeOrderUseCase(m.store).execute(m.order.orderId);
    expect(r).toEqual({ status: 'ATTRIBUTED', linked: 1, credits: 5 });
    expect(m.links).toEqual([{ visitorId: 'fp.1.visitor', method: 'visitor' }]);
    expect(m.saved.filter((c) => c.model === 'last_click')).toMatchObject([{ channel: 'paid_social', detail: 'facebook', creditedUGX: 150_000n }]);
    // Idempotent: a second run links nothing new and replaces the same credits.
    expect(await new AttributeOrderUseCase(m.store).execute(m.order.orderId)).toEqual({ status: 'ATTRIBUTED', linked: 0, credits: 5 });
  });
  it('an unknown order is NOT_FOUND, not an error', async () => {
    expect(await new AttributeOrderUseCase(memoryStore().store).execute('nope')).toEqual({ status: 'NOT_FOUND', linked: 0, credits: 0 });
  });
  it('checkout: records the customer answer once even when the checkout is replayed', async () => {
    const m = memoryStore({ visitorId: null });
    const uc = new RecordCheckoutAttributionUseCase(m.store, new AttributeOrderUseCase(m.store));
    await uc.execute({ orderId: m.order.orderId, heardAbout: 'friend' });
    await uc.execute({ orderId: m.order.orderId, heardAbout: 'friend' });
    expect(m.order.reports).toHaveLength(1);
    expect(m.saved.find((c) => c.model === 'last_click')).toMatchObject({ channel: 'word_of_mouth', basis: 'declared' });
    await uc.execute({ orderId: m.order.orderId, heardAbout: 'a-made-up-answer' });
    expect(m.order.reports).toHaveLength(1);
  });
  it('staff: a WhatsApp reference links the chat visitor\'s visits to the order', async () => {
    const m = memoryStore({ visitorId: null });
    const attribute = new AttributeOrderUseCase(m.store);
    const r = await new RecordOrderSourceUseCase(m.store, attribute).execute({ orderId: m.order.orderId, answer: 'whatsapp', whatsappRef: 'ref gp-7k3q9x', actorId: 'admin-1' });
    expect(r).toEqual({ ok: true, linkedTouches: 1, whatsappRef: 'GP-7K3Q9X' });
    expect(m.links).toEqual([{ visitorId: 'fp.2.whatsapp', method: 'whatsapp_ref' }]);
    expect(m.saved.find((c) => c.model === 'first_touch')).toMatchObject({ channel: 'organic_search', basis: 'observed' });
    expect(m.saved.find((c) => c.model === 'self_reported')).toMatchObject({ channel: 'whatsapp' });
    // The nightly recompute keeps that visitor linked (the reference is on file).
    m.links.length = 0;
    await attribute.execute(m.order.orderId);
    expect(m.links.map((l) => l.visitorId)).toEqual(['fp.2.whatsapp']);
  });
  it('staff: refuses an empty form, an unknown answer, a malformed code and a code nobody was given', async () => {
    const m = memoryStore();
    const uc = new RecordOrderSourceUseCase(m.store, new AttributeOrderUseCase(m.store));
    expect(await uc.execute({ orderId: m.order.orderId, actorId: 'a' })).toMatchObject({ ok: false, code: 'NOTHING_TO_RECORD' });
    expect(await uc.execute({ orderId: m.order.orderId, answer: 'billboard', actorId: 'a' })).toMatchObject({ ok: false, code: 'INVALID_ANSWER' });
    expect(await uc.execute({ orderId: m.order.orderId, whatsappRef: 'hello', actorId: 'a' })).toMatchObject({ ok: false, code: 'INVALID_REF' });
    expect(await uc.execute({ orderId: m.order.orderId, whatsappRef: 'GP-AAAAAA', actorId: 'a' })).toMatchObject({ ok: false, code: 'REF_NOT_FOUND' });
    expect(await uc.execute({ orderId: 'x', answer: 'friend', actorId: 'a' })).toMatchObject({ ok: false, code: 'ORDER_NOT_FOUND' });
    expect(m.order.reports).toHaveLength(0);
  });
  it('the newest staff answer beats the customer\'s own', () => {
    const t = (s: number) => new Date(orderAt.getTime() + s);
    expect(effectiveDeclared([
      { reportedBy: 'customer', answer: 'facebook', whatsappRef: null, note: null, createdAt: t(3) },
      { reportedBy: 'admin', answer: 'friend', whatsappRef: null, note: null, createdAt: t(2) },
      { reportedBy: 'admin', answer: 'tiktok', whatsappRef: null, note: null, createdAt: t(1) },
    ])).toBe('friend');
    expect(effectiveDeclared([{ reportedBy: 'admin', answer: null, whatsappRef: 'GP-7K3Q9X', note: null, createdAt: t(1) }])).toBeNull();
  });
  it('backfill is bounded and counts failures without stopping', async () => {
    const m = memoryStore();
    const attribute = new AttributeOrderUseCase(m.store);
    const failing = { execute: async (id: string) => { if (id === 'broken') throw new Error('x'); return attribute.execute(id); } } as unknown as AttributeOrderUseCase;
    expect(await new BackfillOrderAttributionUseCase(m.store, failing, () => orderAt).execute({ days: 90 })).toEqual({ orders: 2, failed: 1, capped: false });
  });
  it('the weekly report reads only sales (a cancelled or unpaid online order is not one)', async () => {
    const m = memoryStore();
    await new AttributeOrderUseCase(m.store).execute(m.order.orderId);
    const base = { orderAt, totalUGX: 160_000, deliveryFeeUGX: 10_000 };
    m.setSales([
      { ...base, orderId: m.order.orderId, status: 'received', paymentStatus: 'unpaid', paymentMethod: 'offline' },
      { ...base, orderId: 'x2', status: 'pending_payment', paymentStatus: 'unpaid', paymentMethod: 'pesapal' },
      { ...base, orderId: 'x3', status: 'cancelled', paymentStatus: 'unpaid', paymentMethod: 'offline' },
    ]);
    const r = await new GetWeeklyChannelReportUseCase(m.store, { weeklySpend: async () => ({ status: 'NOT_AVAILABLE' }) }, () => orderAt).execute({ model: 'last_click', weeks: 4 });
    expect(r.totals).toMatchObject({ orders: 1, revenueUGX: '150000', spendUGX: null });
    expect(r.channels.map((c) => c.channel)).toEqual(['paid_social']);
  });
  it('the order view shows touches, answers and credits as strings', async () => {
    const m = memoryStore();
    await new AttributeOrderUseCase(m.store).execute(m.order.orderId);
    const v = (await new GetOrderAttributionUseCase(m.store).execute(m.order.orderId))!;
    expect(v).toMatchObject({ orderNumber: 'GP-1001', visitorRecorded: true, effectiveAnswer: null, computedAt: orderAt.toISOString() });
    expect(v.touches).toEqual([{ channel: 'paid_social', detail: 'facebook', at: touch('t1', 'x', 5).at.toISOString() }]);
    expect(v.credits.every((c) => typeof c.creditedUGX === 'string')).toBe(true);
  });
});

describe('collector: WhatsApp reference event', () => {
  const now = new Date('2026-09-20T10:00:00Z');
  const refEvent = (over: Record<string, unknown> = {}) => ({
    event_name: 'whatsapp_ref', event_id: '6f0c5f7e-1b1a-4c1e-9d3a-000000000011', event_time: Math.floor(now.getTime() / 1000), source: 'browser',
    user_data: { fp_client_id: 'fp.page.claim' }, ref: { code: 'GP-7K3Q9X', page_path: '/products/x' }, ...over,
  });
  const env = (events: unknown[]) => JSON.stringify({ batchId: '7f0c5f7e-1b1a-4c1e-9d3a-000000000012', schemaVersion: 1, events });
  function store(withRefs = true) {
    const batches = new Map<string, { contentSha256: string; receipt: BatchReceipt }>();
    const refs: any[] = [];
    const s: CollectorStore = {
      findBatch: async (id) => batches.get(id) ?? null,
      saveBatch: async (id, d, _p, r) => (batches.has(id) ? 'EXISTS' : (batches.set(id, { contentSha256: d, receipt: r }), 'SAVED')),
      saveTouch: async () => {},
      ...(withRefs ? { saveWhatsAppRef: async (r: any) => { refs.push(r); } } : {}),
    };
    return { s, refs };
  }
  it('files the code against the SERVER visitor id and never forwards it', async () => {
    const { s, refs } = store();
    const tracked: unknown[] = [];
    const r: any = await new CollectBrowserBatchUseCase(s, async (e) => { tracked.push(e); }, () => now).execute(env([refEvent()]), 'customer', 'fp.server.id');
    expect(r.status).toBe(202);
    expect(r.receipt.accepted).toEqual(['6f0c5f7e-1b1a-4c1e-9d3a-000000000011']);
    expect(refs).toEqual([{ code: 'GP-7K3Q9X', anonymousId: 'fp.server.id', clientEventId: '6f0c5f7e-1b1a-4c1e-9d3a-000000000011', issuedAt: now, pagePath: '/products/x', trafficClass: 'customer' }]);
    expect(tracked).toHaveLength(0);
  });
  it('rejects a malformed code, a stale event and a store that cannot keep references', async () => {
    const { s, refs } = store();
    const uc = new CollectBrowserBatchUseCase(s, async () => {}, () => now);
    const r: any = await uc.execute(env([refEvent({ ref: { code: 'GP-0000', page_path: null } }), refEvent({ event_id: '6f0c5f7e-1b1a-4c1e-9d3a-000000000013', event_time: Math.floor(now.getTime() / 1000) - 8 * 86400 })]));
    expect(r.receipt.rejected.map((x: any) => x.reason)).toEqual(['SCHEMA_VIOLATION', 'EVENT_TIME_OUT_OF_RANGE']);
    expect(refs).toHaveLength(0);
    const old: any = await new CollectBrowserBatchUseCase(store(false).s, async () => {}, () => now).execute(env([refEvent()]));
    expect(old.receipt.rejected.map((x: any) => x.reason)).toEqual(['UNSUPPORTED_EVENT']);
  });
});
