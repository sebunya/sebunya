import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { friendDisplayName, normaliseReferralCode, referralRefusalWords, referralShareChannel, referralStage } from '../../apps/api/src/domain/loyalty/Referral';
import { classifyChannel } from '../../apps/api/src/domain/measurement/Channels';
import { inviteNoteWords, isLinkPreviewAgent, normaliseInviteCode } from '../../apps/web/src/lib/referralInvite';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** Refer a friend, reworked (2026-10-22): simpler for both people, tracked from the link to the payout. */
describe('codes as people type them', () => {
  it('spaces, dashes and lower case are the same code; nonsense is not a code', () => {
    for (const typed of ['gp4k7m2q', ' GP 4K7 M2Q ', 'gp-4k7-m2q']) expect(normaliseReferralCode(typed)).toBe('GP4K7M2Q');
    expect(normaliseReferralCode('ab')).toBeNull();
    expect(normaliseReferralCode(42)).toBeNull();
    // The storefront applies the same rule as the API.
    for (const typed of ['gp4k7m2q', ' GP 4K7 M2Q ', 'gp-4k7-m2q', 'ab', '']) expect(normaliseInviteCode(typed)).toBe(normaliseReferralCode(typed));
  });
});

describe('what each person reads', () => {
  it('the referrer sees each friend by a short name and a stage, never an email', () => {
    expect(friendDisplayName('sarah  nakato')).toBe('Sarah N.');
    expect(friendDisplayName('Robert')).toBe('Robert');
    expect(friendDisplayName('')).toBe('A friend');
    expect(referralStage({ status: 'pending', friendHasOrdered: false })).toBe('joined');
    expect(referralStage({ status: 'pending', friendHasOrdered: true })).toBe('ordered');
    expect(referralStage({ status: 'held', friendHasOrdered: true })).toBe('checking');
    expect(referralStage({ status: 'awarded', friendHasOrdered: true })).toBe('rewarded');
    expect(referralStage({ status: 'rejected', friendHasOrdered: true })).toBe('not_counted');
  });

  it('a refused code is explained, not dropped', () => {
    expect(referralRefusalWords('SELF_REFERRAL')).toMatch(/own invite code/);
    expect(referralRefusalWords('nope')).toBe('The invite code could not be added.');
    expect(inviteNoteWords('applied')?.kind).toBe('success');
    expect(inviteNoteWords('CODE_NOT_FOUND')?.text).toMatch(/not found/);
    expect(inviteNoteWords(null)).toBeNull();
    expect(read('apps/web/src/pages/register.astro')).toContain("setInviteNote(Astro.cookies, r?.applied ? 'applied'");
  });
});

describe('tracking', () => {
  it('an invite link landing is "Invited by a customer", not direct', () => {
    expect(classifyChannel({ source: 'customer_invite', medium: 'friend' })).toBe('friend_referral');
    expect(classifyChannel({ source: 'customer_invite', medium: 'friend', referrerHost: 'wa.me' })).toBe('friend_referral');
    expect(read('apps/web/src/pages/r/[code].ts')).toContain("utm_medium: 'friend'");
  });

  it('link previews are not counted as people opening the link', () => {
    expect(isLinkPreviewAgent('WhatsApp/2.23.20.0')).toBe(true);
    expect(isLinkPreviewAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isLinkPreviewAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36')).toBe(false);
    expect(referralShareChannel('whatsapp')).toBe('whatsapp');
    expect(referralShareChannel('evil')).toBe('link');
  });

  it('the remembered invite is applied however the friend signs up (middleware), and shares use the short link', () => {
    expect(read('apps/web/src/middleware.ts')).toContain('await applyRememberedInvite(context);');
    const card = read('apps/web/src/components/ReferralCard.astro');
    expect(card).toContain('/r/${referral.code}?via=${via}');
    for (const via of ["message('whatsapp')", "message('sms')", "message('share')", "link('copy')"]) expect(card).toContain(via);
  });

  it('referral qualification runs on every paid retail delivery, and the kill switch hides the card', () => {
    expect(read('apps/api/src/infrastructure/Registry.ts')).toContain('if (orderSource) {');
    expect(read('apps/api/src/interfaces/http/routes/account.ts')).toContain('!config.enabled || config.killSwitch || config.referralReferrerPoints === null');
  });
});
