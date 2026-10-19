import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertText, carePriority, closesMatter, isAbusive, onDutyNow, silenceFor } from '../../apps/api/src/domain/assistant/CareDesk';
import { CareDeskUseCases } from '../../apps/api/src/application/use-cases/assistant/CareDeskUseCases';
import { GoldieOrderActionsUseCases, type GoldieOrderDeps, type VerifiedOrder } from '../../apps/api/src/application/use-cases/assistant/GoldieOrderActionsUseCases';
import type { ICareDeskRepository, CareTaskRow, CareTeamMemberRow } from '../../apps/api/src/application/ports/ICareDeskRepository';
import { SYSTEM_PROMPT, shopperNote } from '../../apps/web/src/lib/assistant';
import { requestCallback, bulkQuote } from '../../apps/web/src/lib/goldieCare';
import { isCallbackFollowUp } from '../../apps/web/src/lib/goldieTurn';

vi.mock('../../apps/web/src/lib/api', () => ({ apiBase: 'http://api.test' }));

/**
 * Owner, 2026-10-13: Goldie should replace the support team's routine work:
 * a senior care expert with Ugandan warmth, who acts (callbacks, escalations,
 * bulk quotes, order changes), knows when not to answer, pages the on-duty team
 * by SMS, email and WhatsApp when a customer is stuck and it is urgent, and a
 * Care Desk the shop attendants can work from without anything technical.
 */

describe('Care Desk rules', () => {
  it('makes an upset money or order matter urgent, and a big bulk lead high', () => {
    expect(carePriority({ kind: 'order_problem', mood: 'upset' })).toBe('urgent');
    expect(carePriority({ kind: 'callback', mood: 'neutral' })).toBe('normal');
    expect(carePriority({ kind: 'bulk_lead', units: 200 })).toBe('high');
    expect(carePriority({ kind: 'follow_up', urgentHint: true })).toBe('urgent');
  });

  it('knows who is on duty in Kampala time, including overnight shifts', () => {
    const tueNoonEAT = new Date('2026-10-13T09:00:00Z'); // 12:00 in Kampala, a Tuesday
    expect(onDutyNow({ days: [1, 2, 3, 4, 5], from: '08:00', to: '18:00' }, tueNoonEAT)).toBe(true);
    expect(onDutyNow({ days: [0, 6], from: '08:00', to: '18:00' }, tueNoonEAT)).toBe(false);
    expect(onDutyNow({ from: '22:00', to: '06:00' }, new Date('2026-10-13T21:00:00Z'))).toBe(true); // 00:00 EAT
    expect(onDutyNow(null, tueNoonEAT)).toBe(true);
  });

  it('writes an alert a person can act on from their phone', () => {
    const s = alertText({ kind: 'urgent', title: 'Money left her phone but order shows unpaid', customerName: 'Sarah', customerPhone: '0772123456', orderNumber: 'GP-202610-ABCD1234' });
    expect(s).toMatch(/^GoldPlus Care: Urgent/);
    expect(s).toContain('0772123456');
    expect(s.length).toBeLessThanOrEqual(300);
  });
});

describe('when not to answer (WhatsApp)', () => {
  const base = { text: 'ok thanks', teamHasIt: false, fromStaff: false, lastGoldieClosed: true, sameTextRecently: 1, abuseRecently: 0 };
  it('stays quiet on "ok thanks" after a settled answer, but answers it when a question is still open', () => {
    expect(silenceFor(base)).toBe('ACK_AFTER_CLOSE');
    expect(silenceFor({ ...base, lastGoldieClosed: false })).toBeNull();
    expect(closesMatter('Which phone is it for?')).toBe(false);
    expect(closesMatter('Your order is on its way.')).toBe(true);
  });
  it('lets a colleague carry on, ignores staff, emoji-only, repeats and a stream of abuse; answers a real question', () => {
    expect(silenceFor({ ...base, text: 'where is my order', teamHasIt: true })).toBe('TEAM_HAS_IT');
    expect(silenceFor({ ...base, text: 'test', fromStaff: true })).toBe('STAFF_NUMBER');
    expect(silenceFor({ ...base, text: '👍👍' })).toBe('EMOJI_ONLY');
    expect(silenceFor({ ...base, text: 'hello?', sameTextRecently: 3 })).toBe('REPEATED');
    expect(silenceFor({ ...base, text: 'you idiot', abuseRecently: 3 })).toBe('ABUSE_LIMIT');
    expect(silenceFor({ ...base, text: 'Do you have a Tecno Spark 10 battery?' })).toBeNull();
    expect(isAbusive('you are an idiot')).toBe(true);
  });
});

let alertsSoFar = { shop: 0, samePhone: 0 };
function desk(team: Partial<CareTeamMemberRow>[] = [], fallback?: { emails: string[]; phone: string | null }) {
  alertsSoFar = { shop: 0, samePhone: 0 };
  const tasks: CareTaskRow[] = [];
  const members: CareTeamMemberRow[] = team.map((m, i) => ({ id: `m${i}`, name: `Member ${i}`, roleLabel: null, phone: '0772000000', email: 'm@example.com', alertSms: true, alertEmail: true, alertWhatsapp: false, onDuty: null, active: true, ...m }));
  const repo: ICareDeskRepository = {
    async open(t) {
      const ex = tasks.find((x) => x.conversationId && x.conversationId === t.conversationId && x.kind === t.kind && x.status === 'open');
      if (ex) return { task: ex, created: false };
      const row: CareTaskRow = { ...t, id: `t${tasks.length}`, status: 'open', assignedTo: null, resolvedBy: null, resolution: null, alertedAt: null, resolvedAt: null, createdAt: new Date() };
      tasks.push(row); return { task: row, created: true };
    },
    async get(id) { return tasks.find((t) => t.id === id) ?? null; },
    async list() { return tasks; },
    async resolve() { return true; }, async assign() { return true; },
    async alertsSince() { return { shop: alertsSoFar.shop, samePhone: alertsSoFar.samePhone }; },
    async purgeClosedBefore() { return 0; },
    async markAlerted(id) { const t = tasks.find((x) => x.id === id); if (t) t.alertedAt = new Date(); },
    async claimAlert(id) { const t = tasks.find((x) => x.id === id); if (!t || t.alertedAt) return false; t.alertedAt = new Date(); return true; },
    async withAlertLock(fn) { return fn(); },
    async lastTitled() { return null; },
    async team(activeOnly) { return members.filter((m) => !activeOnly || m.active); },
    async saveMember(m) { return { ...m, id: m.id ?? 'new' } as CareTeamMemberRow; }, async removeMember() { return true; },
    async staffNumbers() { return []; }, async today() { throw new Error('unused'); }, async rate() { return true; }, async setNextAction() {},
  };
  const sent: string[] = [];
  const alerts = {
    sms: vi.fn(async (i: { to: string }) => { sent.push(`sms:${i.to}`); return { queued: true }; }),
    email: vi.fn(async (i: { to: string }) => { sent.push(`email:${i.to}`); return { queued: true }; }),
    whatsapp: vi.fn(async () => ({ queued: false, reason: 'no template' })),
  };
  const uc = new CareDeskUseCases(repo, alerts, { deskUrl: 'https://shopgoldplus.com/admin/care', fallback }, () => new Date('2026-10-13T09:00:00Z'));
  return { uc, tasks, sent, alerts };
}

describe('Care Desk use cases', () => {
  it('pages only the on-duty team, once, for an urgent task; a normal task just waits on the desk', async () => {
    const d = desk([{ name: 'Grace', onDuty: { days: [2], from: '08:00', to: '18:00' } }, { name: 'Night', phone: '0700111222', email: 'n@example.com', onDuty: { days: [2], from: '20:00', to: '23:00' } }]);
    const normal = await d.uc.openTask({ kind: 'follow_up', title: 'Ask about the cable colour', customerPhone: '0772123456' });
    expect(normal.ok && normal.alerted).toEqual([]);
    const urgent = await d.uc.openTask({ kind: 'order_problem', title: 'Order never came', mood: 'upset', customerPhone: '0772123456', conversationId: 'c1' });
    expect(urgent.ok && urgent.task.priority).toBe('urgent');
    expect(urgent.ok && urgent.alerted).toEqual(['sms:Grace', 'email:Grace']);
    const again = await d.uc.openTask({ kind: 'order_problem', title: 'Still nothing!!', mood: 'upset', customerPhone: '0772123456', conversationId: 'c1' });
    expect(again.ok && again.created).toBe(false);
    expect(d.sent).toHaveLength(2);
  });

  it('when nobody is on duty, an urgent customer still reaches everyone active', async () => {
    const d = desk([{ name: 'Weekend', onDuty: { days: [0, 6] } }]);
    const r = await d.uc.openTask({ kind: 'urgent', title: 'Customer stuck at checkout with money deducted', customerPhone: '0772123456' });
    expect(r.ok && r.alerted.length).toBeGreaterThan(0);
  });

  it('a callback needs a number; a card number never reaches the desk', async () => {
    const d = desk();
    expect(await d.uc.openTask({ kind: 'callback', title: 'Call me' })).toMatchObject({ ok: false });
    const r = await d.uc.openTask({ kind: 'follow_up', title: 'Paid with 4111 1111 1111 1111 but nothing', customerPhone: '0772123456' });
    expect(r.ok && r.task.title).not.toMatch(/4111/);
  });
});

describe('alerts cannot be abused', () => {
  it('pages once per customer per 30 minutes and never past the hourly cap, but the task stays urgent', async () => {
    const { alertAllowed } = await import('../../apps/api/src/domain/assistant/CareDesk');
    expect(alertAllowed({ samePhoneLast30Min: 0, shopLastHour: 3, perHour: 12 })).toBe('ALLOWED');
    expect(alertAllowed({ samePhoneLast30Min: 1, shopLastHour: 0, perHour: 12 })).toBe('SAME_CUSTOMER_RECENTLY');
    expect(alertAllowed({ samePhoneLast30Min: 0, shopLastHour: 12, perHour: 12 })).toBe('HOURLY_CAP');
    const d = desk([{ name: 'Grace' }]);
    alertsSoFar = { shop: 12, samePhone: 0 };
    const r = await d.uc.openTask({ kind: 'urgent', title: 'Customer stuck with money deducted', customerPhone: '0772123456' });
    expect(r.ok && r.task.priority).toBe('urgent');
    expect(r.ok && r.alerted).toEqual([]);
    expect(d.sent).toEqual([]);
  });

  it('the same person listed twice (0705… and +256705…) is paged once per channel', async () => {
    const d = desk([{ name: 'Grace', phone: '0705004545', email: 'g@example.com' }, { name: 'Grace again', phone: '+256705004545', email: 'G@example.com' }]);
    const r = await d.uc.openTask({ kind: 'urgent', title: 'Customer stuck with money deducted', customerPhone: '0772123456' });
    expect(r.ok && r.alerted).toEqual(['sms:Grace', 'email:Grace']);
  });

  it('a task pages at most once, even when alert() is called twice for it (two replicas)', async () => {
    const d = desk([{ name: 'Grace' }]);
    const r = await d.uc.openTask({ kind: 'urgent', title: 'Customer stuck with money deducted', customerPhone: '0772123456' });
    expect(r.ok && r.alerted.length).toBe(2);
    const stale = { ...(r.ok ? r.task : ({} as never)), alertedAt: null };
    expect(await d.uc.alert(stale)).toEqual([]);
    expect(d.sent).toHaveLength(2);
  });
});

describe('Goldie order actions (policy, once wired)', () => {
  const order = (o: Partial<VerifiedOrder> = {}): VerifiedOrder => ({ id: 'o1', orderNumber: 'GP-202610-ABCD1234', orderStatus: 'received', paymentStatus: 'unpaid', totalUgx: 90000, customerName: 'Sarah', customerPhone: '0772123456', ...o });
  function actions(o: VerifiedOrder | null, payments: Array<{ merchantReference: string; amount: number }> = [], cap = 300000) {
    const calls: string[] = [];
    const deps: GoldieOrderDeps = {
      verify: async () => (o ? { ok: true, order: o } : { ok: false, code: 'VERIFICATION_FAILED', message: 'x', status: 401 }),
      cancel: async (id) => { calls.push(`cancel:${id}`); },
      completedPayments: async () => payments,
      refund: async (i) => { calls.push(`refund:${i.amountUgx}`); return { ok: true, refundId: 'r1' }; },
      note: async (_id, n) => { calls.push(`note:${n}`); },
      openTask: async (t) => { calls.push(`task:${t.kind}`); return {}; },
    };
    return { uc: new GoldieOrderActionsUseCases(deps, { refundCapUgx: cap }), calls };
  }
  const req = { reference: 'GP-202610-ABCD1234', contact: '0772123456', reason: 'changed my mind', channel: 'web', conversationId: null };

  it('cancels an unpaid order outright, and refuses one already with the rider', async () => {
    const a = actions(order());
    expect(await a.uc.cancel(req)).toMatchObject({ ok: true, done: 'cancelled' });
    expect(a.calls).toEqual(['cancel:o1']);
    const late = actions(order({ orderStatus: 'dispatched' }));
    expect(await late.uc.cancel(req)).toMatchObject({ ok: false, code: 'TOO_LATE' });
    expect(late.calls).toEqual([]);
  });

  it('cancels a paid online order and refunds it in full, within the cap', async () => {
    const a = actions(order({ paymentStatus: 'paid' }), [{ merchantReference: 'GP-PAY-1', amount: 90000 }]);
    const r = await a.uc.cancel(req);
    expect(r).toMatchObject({ ok: true, refunded: 90000 });
    expect(a.calls).toEqual(['cancel:o1', 'refund:90000']);
  });

  it('over the cap, or paid offline: cancelled, and the refund goes to the team as urgent', async () => {
    const big = actions(order({ paymentStatus: 'paid', totalUgx: 900000 }), [{ merchantReference: 'P', amount: 900000 }]);
    expect(await big.uc.cancel(req)).toMatchObject({ ok: true, escalated: true });
    expect(big.calls).toEqual(['cancel:o1', 'task:urgent']);
    const cash = actions(order({ paymentStatus: 'paid' }), []);
    expect(await cash.uc.cancel(req)).toMatchObject({ ok: true, escalated: true });
  });

  it('never acts without proof, and writes rider instructions on a live order', async () => {
    expect(await actions(null).uc.cancel(req)).toMatchObject({ ok: false });
    const a = actions(order({ orderStatus: 'dispatched' }));
    const r = await a.uc.deliveryInstructions({ reference: req.reference, contact: req.contact, instructions: 'Call when at Shell Ntinda, I will come out', channel: 'whatsapp' });
    expect(r).toMatchObject({ ok: true, done: 'noted' });
    expect(a.calls[0]).toMatch(/^note:Customer via Goldie/);
  });
});

describe('Goldie the senior care expert', () => {
  it('has the care skills, Ugandan warmth, no machine phrases, and stays honest when sincerely asked', () => {
    expect(SYSTEM_PROMPT).toMatch(/senior care expert/i);
    expect(SYSTEM_PROMPT).toMatch(/Thank you for choosing GoldPlus/);
    expect(SYSTEM_PROMPT).toMatch(/Never sound like a machine/);
    expect(SYSTEM_PROMPT).toContain('"As an AI"');
    expect(SYSTEM_PROMPT).toContain('Never claim to be human');
    expect(SYSTEM_PROMPT).toMatch(/bulk_quote/);
    expect(SYSTEM_PROMPT).toMatch(/No fake urgency/);
  });

  it('turns the next-best action into a hint, not a script', () => {
    const note = shopperNote({ firstName: 'Sarah', visits: 5, hasOrdered: true, topCategories: [], recentlyViewed: [], pastTopics: [], nextBestAction: 'LOYALTY_ACTION' });
    expect(note).toMatch(/Next best action: the customer has points to use/);
    expect(shopperNote({ firstName: null, visits: 1, hasOrdered: false, topCategories: [], recentlyViewed: [], pastTopics: [], nextBestAction: 'NO_ACTION' })).not.toMatch(/Next best action/);
  });
});

describe('Goldie acting from the chat', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const ctx = { bearer: null, clientAddress: null, site: 'https://shopgoldplus.com', channel: 'web' as const, conversationKey: 'conv-12345678', mood: 'neutral' };

  it('asks which number before booking a call, then books it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { taskId: 't1', priority: 'normal', alerted: 0 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await requestCallback({ reason: 'battery fit' }, ctx)).text).toMatch(/Which number/);
    expect(fetchMock).not.toHaveBeenCalled();
    const r = await requestCallback({ reason: 'battery fit', phone: '0772123456' }, ctx);
    expect(r.text).toMatch(/booked a call to 0772123456/);
    expect(isCallbackFollowUp([{ role: 'user', content: 'call me' }, { role: 'assistant', content: 'Of course. Which number should the team call you on?' }, { role: 'user', content: '0772 123 456' }])).toBe(true);
  });

  it('files a bulk request in cartons and puts the lead on the desk', async () => {
    const bodies: Array<{ url: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      bodies.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith('/quotes/bulk')) return new Response(JSON.stringify({ success: true, data: { quoteId: 'q', request: { reference: 'BQ-7F3A', totals: { totalUnits: 6000, totalCartons: 120, lineCount: 2 } } } }), { status: 201 });
      return new Response(JSON.stringify({ success: true, data: { taskId: 't', priority: 'high', alerted: 0 } }), { status: 200 });
    }));
    const r = await bulkQuote({ name: 'Moses', phone: '0772123456', businessName: 'Moses Phones', buyerType: 'wholesale', lines: [{ productId: '3f1c2b9a-1111-4a2b-9c3d-123456789abc', count: 100 }, { productId: '3f1c2b9a-2222-4a2b-9c3d-123456789abc', count: 20 }] }, ctx);
    expect(r.text).toMatch(/BQ-7F3A/);
    // Counts are cartons, as on /bulk.
    expect(r.text).toMatch(/120 cartons across 2 products/);
    expect(r.text).not.toMatch(/bulk price is|UGX/);
    expect(bodies[0]!.body).toMatchObject({ customerName: 'Moses', buyerType: 'wholesale', lines: [{ count: 100 }, { count: 20 }] });
    expect(bodies[0]!.body.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    expect(bodies[1]!.body).toMatchObject({ kind: 'bulk_lead', units: 6000, title: 'Bulk request BQ-7F3A: 120 cartons from Moses Phones' });
  });
});

describe('before the team is set up', () => {
  it('an urgent customer pages the shop inbox and phone; adding a team member ends the fallback', async () => {
    const shop = { emails: ['orders@shopgoldplus.com'], phone: '+256705004545' };
    const empty = desk([], shop);
    const r = await empty.uc.openTask({ kind: 'urgent', title: 'Money taken, no order', urgent: true, customerPhone: '0772123456' });
    expect(r.ok && r.alerted).toEqual(['email:Shop inbox', 'sms:Shop phone']);
    expect(empty.sent).toEqual(['email:orders@shopgoldplus.com', 'sms:+256705004545']);
    expect(await empty.uc.testAlert()).toEqual(['email:Shop inbox', 'sms:Shop phone']);
    const staffed = desk([{ name: 'Grace' }], shop);
    await staffed.uc.openTask({ kind: 'urgent', title: 'Money taken, no order', urgent: true, customerPhone: '0772123456' });
    expect(staffed.sent).toEqual(['sms:0772000000', 'email:m@example.com']);
    expect(await desk([]).uc.openTask({ kind: 'urgent', title: 'Money taken, no order', urgent: true }).then((x) => x.ok && x.alerted)).toEqual([]);
  });
});
