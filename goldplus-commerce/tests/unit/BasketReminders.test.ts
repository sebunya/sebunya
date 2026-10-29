import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASKET_REMINDERS_COPY_VERSION, basketRemindersCopyHash, planBasketReminderChange, basketReminderStatus } from '../../apps/api/src/domain/consent/BasketReminderConsent';
import { SendBasketRemindersUseCase, basketItemsWords, basketReminderSendRefusal, type BasketReminderCandidate, type IBasketReminderCandidates } from '../../apps/api/src/application/use-cases/abandonment/SendBasketRemindersUseCase';
import { BasketReminderConsentUseCases } from '../../apps/api/src/application/use-cases/first-party/BasketReminderConsentUseCases';
import { DefaultNotificationRouter } from '../../apps/api/src/infrastructure/notifications/NotificationRouter';
import { smsSegments } from '../../packages/shared/src/links/shopLinkTag';
import { CONSENT_PURPOSE_KEYS } from '../../apps/api/src/application/ports/consent/ConsentOperatingRepository';
import { classifyMessage, consentGrantedIn } from '../../apps/api/src/infrastructure/notifications/messageClassification';
import { smsText } from '../../apps/api/src/application/notifications/CustomerMessages';

const root = resolve(__dirname, '../..');
const NOON_EAT = new Date('2026-10-26T09:00:00Z');
const cand = (id: string, userId = 'u1'): BasketReminderCandidate => ({ abandonmentId: id, cartId: 'c' + id, userId, itemCount: 3, subtotalUgx: 90000, itemNames: ['Oraimo powerbank', 'USB-C cable'] });

describe('basket reminders: consent', () => {
  it('is its own purpose, off by default, and a grant needs the tick, the words, a phone', () => {
    expect(CONSENT_PURPOSE_KEYS).toContain('basket_reminders');
    expect(basketReminderStatus(null)).toBe('NOT_OPTED_IN');
    const base = { current: null, requested: 'granted' as const, confirmationTicked: true, copyVersionId: BASKET_REMINDERS_COPY_VERSION, signedInAccount: true, phoneE164: '+256772123456' };
    expect(planBasketReminderChange(base)).toMatchObject({ ok: true, next: 'granted' });
    expect(planBasketReminderChange({ ...base, confirmationTicked: false })).toEqual({ ok: false, reason: 'CONFIRMATION_REQUIRED' });
    expect(planBasketReminderChange({ ...base, phoneE164: null })).toEqual({ ok: false, reason: 'PHONE_REQUIRED' });
    expect(planBasketReminderChange({ ...base, requested: 'withdrawn', confirmationTicked: false })).toMatchObject({ ok: true, next: 'withdrawn' });
  });
  it('0210 pins the hash of the exact words, and sign-up shows the same words', () => {
    const sql = readFileSync(resolve(root, 'apps/api/src/infrastructure/db/migrations/0210_basket_reminders.sql'), 'utf8');
    expect(sql).toContain(basketRemindersCopyHash());
    const reg = readFileSync(resolve(root, 'apps/web/src/pages/register.astro'), 'utf8');
    expect(reg).toContain('Yes, text me if I leave something in my basket, at the phone number on my account. At most one text a week.');
    expect(reg).not.toMatch(/name="basketReminders"[^>]*checked/);
  });
});

describe('basket reminders: sending', () => {
  it('the reminder is marketing, allowed only with the consent marker', () => {
    expect(classifyMessage({ template: 'BASKET_REMINDER', recipient: 'x', data: {} } as never)).toBe('MARKETING');
    const marker = { consent: { purpose: 'basket_reminders', granted: true } };
    expect(consentGrantedIn(marker, 'BASKET_REMINDER', 'sms')).toBe(true);
    // Only the allowlisted template, purpose and channel: any other marketing message carrying a marker stays blocked.
    expect(consentGrantedIn(marker, 'BASKET_REMINDER', 'email')).toBeUndefined();
    expect(consentGrantedIn(marker, 'SOME_PROMOTION', 'sms')).toBeUndefined();
    expect(consentGrantedIn({ consent: { purpose: 'marketing_offers', granted: true } }, 'BASKET_REMINDER', 'sms')).toBeUndefined();
    expect(consentGrantedIn(marker)).toBeUndefined();
    expect(consentGrantedIn({ consent: { granted: 'yes' } }, 'BASKET_REMINDER', 'sms')).toBeUndefined();
    expect(consentGrantedIn({}, 'BASKET_REMINDER', 'sms')).toBeUndefined();
  });
  /** A candidate store that records what the use case did. */
  const store = (due: BasketReminderCandidate[], claim: (id: string) => boolean = () => true) => {
    const marked: Array<[string, string]> = [];
    const settled: Array<[string, string]> = [];
    const claimed: string[] = [];
    const s: IBasketReminderCandidates = {
      findDue: async () => due,
      markReminded: async (id, _n, o) => { marked.push([id, o]); },
      claimForReminder: async ({ abandonmentId }) => { const ok = claim(abandonmentId); if (ok) claimed.push(abandonmentId); return ok; },
      settleReminder: async (id, o) => { settled.push([id, o]); },
    };
    return { s, marked, settled, claimed };
  };
  const GATE: Record<string, { allowed: boolean; reason: string; phoneE164: string | null }> = {
    yes: { allowed: true, reason: 'OPTED_IN', phoneE164: '+256772123456' },
    no: { allowed: false, reason: 'NOT_OPTED_IN', phoneE164: null },
    unverified: { allowed: false, reason: 'PHONE_NOT_VERIFIED', phoneE164: null },
    closed: { allowed: false, reason: 'ACCOUNT_INACTIVE', phoneE164: null },
    stop: { allowed: false, reason: 'SUPPRESSED', phoneE164: null },
  };
  const gate = { mayRemind: async (u: string) => GATE[u] ?? GATE.no };

  it('texts only consenting customers with a known number, and records each refusal with its own reason', async () => {
    const sent: string[] = [];
    const st = store([cand('a', 'yes'), cand('b', 'no'), cand('c', 'unverified'), cand('d', 'closed'), cand('e', 'stop')]);
    const uc = new SendBasketRemindersUseCase(st.s, gate, async (c) => { sent.push(c.abandonmentId); });
    expect(await uc.execute(NOON_EAT)).toMatchObject({ due: 5, sent: 1, refused: 4, failed: 0 });
    expect(sent).toEqual(['a']);
    expect(st.claimed).toEqual(['a']);
    expect(st.settled).toEqual([['a', 'sent']]);
    expect(st.marked).toEqual([['b', 'not_opted_in'], ['c', 'unverified'], ['d', 'inactive'], ['e', 'suppressed']]);
  });

  it('a basket with nothing left to buy, or a customer in the holdout, gets no text (recorded, not retried)', async () => {
    const sent: string[] = [];
    const st = store([{ ...cand('a', 'yes'), itemCount: 0, itemNames: [] }, cand('b', 'yes')]);
    const uc = new SendBasketRemindersUseCase(st.s, gate, async (c) => { sent.push(c.abandonmentId); }, () => true, async () => 'hold');
    expect(await uc.execute(NOON_EAT)).toMatchObject({ sent: 0, refused: 1, held: 1 });
    expect(sent).toEqual([]);
    expect(st.marked).toEqual([['a', 'nothing_left'], ['b', 'held_out']]);
  });

  it('sends only what it could claim: a second basket of the same customer, or another replica, finds the claim taken', async () => {
    const sent: string[] = [];
    const st = store([cand('a', 'yes'), cand('b', 'yes')], (id) => id === 'a');
    const uc = new SendBasketRemindersUseCase(st.s, gate, async (c) => { sent.push(c.abandonmentId); });
    expect(await uc.execute(NOON_EAT)).toMatchObject({ sent: 1 });
    expect(sent).toEqual(['a']);
  });

  it('a send that throws is settled as failed (never retried into a second text) and logged', async () => {
    const logs: string[] = [];
    const st = store([cand('a', 'yes')]);
    const uc = new SendBasketRemindersUseCase(st.s, gate, async () => { throw new Error('outbox down'); }, () => true, async () => 'treat', (e) => { logs.push(e); });
    expect(await uc.execute(NOON_EAT)).toMatchObject({ sent: 0, failed: 1 });
    expect(st.settled).toEqual([['a', 'failed']]);
    expect(logs).toEqual(['basket_reminder_failed']);
  });

  it('queues with a send-by time an hour ahead, and queues nothing in or just before quiet hours, or when switched off', async () => {
    const by: Date[] = [];
    const st = store([cand('a', 'yes')]);
    const uc = new SendBasketRemindersUseCase(st.s, gate, async (_c, _p, sendBy) => { by.push(sendBy); });
    await uc.execute(NOON_EAT);
    expect(by[0].getTime() - NOON_EAT.getTime()).toBe(60 * 60_000);
    expect(await uc.execute(new Date('2026-10-26T20:00:00Z'))).toMatchObject({ due: 0 }); // 23:00 Kampala
    expect(await uc.execute(new Date('2026-10-26T17:50:00Z'))).toMatchObject({ due: 0 }); // 20:50: would be refused at 21:00
    expect(await new SendBasketRemindersUseCase(st.s, gate, async () => undefined, () => false).execute(NOON_EAT)).toMatchObject({ disabled: true });
  });

  it('at send time a queued reminder is refused when stale, in quiet hours, undated or switched off', () => {
    const fresh = { notAfter: new Date(NOON_EAT.getTime() + 30 * 60_000).toISOString() };
    expect(basketReminderSendRefusal(fresh, NOON_EAT, true)).toBeNull();
    expect(basketReminderSendRefusal(fresh, NOON_EAT, false)).toMatch(/switched off/);
    expect(basketReminderSendRefusal(fresh, new Date(NOON_EAT.getTime() + 31 * 60_000), true)).toMatch(/past its send-by time/);
    expect(basketReminderSendRefusal({}, NOON_EAT, true)).toMatch(/no send-by time/);
    expect(basketReminderSendRefusal({ notAfter: '2026-10-26T19:30:00Z' }, new Date('2026-10-26T18:10:00Z'), true)).toMatch(/quiet hours/); // 21:10
  });

  it('the router sends it by SMS only, and a stale one is recorded as refused, never sent or retried', async () => {
    const calls: string[] = [];
    const prov = (name: string) => ({ dispatch: async () => { calls.push(name); return { status: 'SENT' as const, providerCode: null, providerMessage: 'ok' }; }, canCarry: () => true });
    const router = new DefaultNotificationRouter(prov('email'), prov('whatsapp'), prov('sms'));
    const payload = { customerPhone: '+256772123456', customerEmail: 'a@b.co', relatedEntity: 'cart', relatedEntityId: '00000000-0000-4000-8000-000000000001', notAfter: new Date(Date.now() + 30 * 60_000).toISOString() };
    const quiet = (() => { const h = (new Date().getUTCHours() + 3) % 24; return h >= 21 || h < 8; })();
    const targets = await router.route('BASKET_REMINDER', payload);
    expect(targets.map((t) => t.channel)).toEqual(['sms']);
    expect(targets[0].fallback).toBeUndefined();
    const live = await targets[0].provider.dispatch(targets[0].payload);
    if (quiet) expect(live.status).toBe('DISABLED');
    else { expect(live.status).toBe('SENT'); expect(calls).toEqual(['sms']); }
    const stale = await router.route('BASKET_REMINDER', { ...payload, notAfter: new Date(Date.now() - 60_000).toISOString() });
    const r = await stale[0].provider.dispatch(stale[0].payload);
    expect(r).toMatchObject({ status: 'DISABLED', providerCode: 'BASKET_REMINDER_REFUSED', retryable: false });
  });

  it('the gate wants a number known to reach its owner: verified, or an order of theirs was delivered to it', async () => {
    const hasher = { hash: (v: string) => `h:${v}` };
    const consent = {
      getLatestConsentState: async () => ({ state: 'granted', last_consent_event_id: 'e1' }),
      hasActiveChannelSuppression: async () => false,
    };
    const evidence = { latestFor: async () => ({ endpointHash: 'h:+256772123456', capturedAt: new Date() }) };
    const gateFor = (account: Record<string, unknown>, reached = false) => new BasketReminderConsentUseCases(
      consent as never, evidence as never,
      { findAccount: async () => ({ id: 'u', email: null, phone: '0772123456', ...account }), phoneReachedByOrder: async () => reached } as never,
      hasher as never,
    );
    expect(await gateFor({ phoneVerified: true }).mayRemind('u')).toMatchObject({ allowed: true, phoneE164: '+256772123456' });
    expect(await gateFor({ phoneVerified: false }).mayRemind('u')).toMatchObject({ allowed: false, reason: 'PHONE_NOT_VERIFIED' });
    expect(await gateFor({ phoneVerified: false }, true).mayRemind('u')).toMatchObject({ allowed: true });
    expect(await gateFor({ phoneVerified: true, isActive: false }).mayRemind('u')).toMatchObject({ allowed: false, reason: 'ACCOUNT_INACTIVE' });
    // The consent is read first: a customer who never ticked the box reads "not opted in" whatever their phone.
    const neverTicked = new BasketReminderConsentUseCases(
      { getLatestConsentState: async () => null, hasActiveChannelSuppression: async () => false } as never, evidence as never,
      { findAccount: async () => ({ id: 'u', email: null, phone: '0772123456', phoneVerified: false }), phoneReachedByOrder: async () => false } as never,
      hasher as never,
    );
    expect(await neverTicked.mayRemind('u')).toMatchObject({ allowed: false, reason: 'NOT_OPTED_IN', phoneE164: null });
  });

  it('names what was left, in plain GSM within two parts, says the basket is on the account and how to stop', () => {
    expect(basketItemsWords(['A', 'B'], 3)).toBe('A, B and 1 more item');
    expect(basketItemsWords(['A'], 1)).toBe('A');
    // A curly quote folds to plain GSM; a long name is cut at a word, at most 40 characters.
    expect(basketItemsWords(['Oraimo ‘Traveler’ powerbank'], 1)).toBe("Oraimo 'Traveler' powerbank");
    const long = basketItemsWords(['GoldPlus Super Fast Charging 20000mAh Power Bank with Digital Display and Two Cables'], 1);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toBe('GoldPlus Super Fast Charging 20000mAh');
    const t = smsText('BASKET_REMINDER' as never, { basketItems: 'A', basketUrl: 'https://shopgoldplus.com/cart?ch=s.basket', preferencesUrl: 'https://shopgoldplus.com/account/preferences' } as never)!;
    expect(t).toMatch(/you left A in your basket\. It is saved on your account: https:\/\/shopgoldplus\.com\/cart\?ch=s\.basket/i);
    expect(t).toContain('To stop these texts: https://shopgoldplus.com/account/preferences');
    const worst = basketItemsWords(['GoldPlus Super Fast Charging 20000mAh Power Bank with Display', 'Braided USB-C to Lightning Cable 2 metres long for iPhone'], 99);
    const w = smsText('BASKET_REMINDER' as never, { basketItems: worst, basketUrl: 'https://shopgoldplus.com/cart?ch=s.basket', preferencesUrl: 'https://shopgoldplus.com/account/preferences' } as never)!;
    expect(smsSegments(w)).toBeLessThanOrEqual(2);
  });
  it('the cart page asks a signed-out phone to sign in for its saved basket instead of showing it empty', () => {
    const cart = readFileSync(resolve(root, 'apps/web/src/pages/cart.astro'), 'utf8');
    expect(cart).toContain("const fromBasketReminder = Astro.url.searchParams.get('ch') === 's.basket';");
    expect(cart).toContain('Sign in to see my basket');
  });
});
