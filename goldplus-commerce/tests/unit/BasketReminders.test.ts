import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASKET_REMINDERS_COPY_VERSION, basketRemindersCopyHash, planBasketReminderChange, basketReminderStatus } from '../../apps/api/src/domain/consent/BasketReminderConsent';
import { SendBasketRemindersUseCase, basketItemsWords, type BasketReminderCandidate } from '../../apps/api/src/application/use-cases/abandonment/SendBasketRemindersUseCase';
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
    expect(consentGrantedIn({ consent: { purpose: 'basket_reminders', granted: true } })).toBe(true);
    expect(consentGrantedIn({ consent: { granted: 'yes' } })).toBeUndefined();
    expect(consentGrantedIn({})).toBeUndefined();
  });
  it('texts only consenting customers, records refusals, and holds in quiet hours', async () => {
    const marked: Array<[string, string]> = [];
    const sent: string[] = [];
    const uc = new SendBasketRemindersUseCase(
      { findDue: async () => [cand('a', 'yes'), cand('b', 'no')], markReminded: async (id, _n, o) => { marked.push([id, o]); } },
      { mayRemind: async (u) => (u === 'yes' ? { allowed: true, reason: 'OPTED_IN', phoneE164: '+256772123456' } : { allowed: false, reason: 'NOT_OPTED_IN', phoneE164: null }) },
      async (c) => { sent.push(c.abandonmentId); },
    );
    expect(await uc.execute(NOON_EAT)).toMatchObject({ due: 2, sent: 1, refused: 1 });
    expect(sent).toEqual(['a']);
    expect(marked).toEqual([['a', 'sent'], ['b', 'not_opted_in']]);
    expect(await uc.execute(new Date('2026-10-26T20:00:00Z'))).toMatchObject({ due: 0, sent: 0 });
  });
  it('names what was left and says how to stop', () => {
    expect(basketItemsWords(['A', 'B'], 3)).toBe('A, B and 1 more item');
    expect(basketItemsWords(['A'], 1)).toBe('A');
    const t = smsText('BASKET_REMINDER' as never, { basketItems: 'A', basketUrl: 'https://shopgoldplus.com/cart', preferencesUrl: 'https://shopgoldplus.com/account/preferences' } as never)!;
    expect(t).toMatch(/you left A in your basket/i);
    expect(t).toContain('/account/preferences');
  });
});
