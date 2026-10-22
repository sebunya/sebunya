/**
 * Refer a friend: the pure rules (2026-10-22 rework). No framework, no database.
 *
 * A friend's code reaches us four ways (ReferralSource), every one ends in the same pending referral, and it pays
 * both sides when the friend's first paid retail order is delivered. A referral a person must look at is 'held'
 * (it used to stay 'pending' and could never pay); a person releases or refuses it.
 */

export type ReferralStatus = 'pending' | 'held' | 'awarded' | 'rejected';
/** link = opened an invite link; typed = typed at sign-up; social = Google/Facebook sign-up after a link; account = added afterwards. */
export type ReferralSource = 'link' | 'typed' | 'social' | 'account';
export const REFERRAL_SOURCES: readonly ReferralSource[] = ['link', 'typed', 'social', 'account'];
/** The button the referrer shared with, carried on the link (?via=). */
export type ReferralShareChannel = 'whatsapp' | 'sms' | 'share' | 'copy' | 'link';
const SHARE_CHANNELS: readonly ReferralShareChannel[] = ['whatsapp', 'sms', 'share', 'copy', 'link'];

/** How long an invite link is remembered in the friend's browser. */
export const REFERRAL_LINK_DAYS = 60;

/**
 * A code as people really type or paste it: "gp 4k7 m2q", "GP-4K7M2Q", "gp4k7m2q " are all GP4K7M2Q. Null when
 * what is left cannot be a code. Codes are GP + 6 from an alphabet without 0/O/1/I; older or custom codes may be
 * 4–12 letters and digits, so only the shape is checked here and the database decides whether it exists.
 */
export function normaliseReferralCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

export function referralShareChannel(input: unknown): ReferralShareChannel {
  return typeof input === 'string' && (SHARE_CHANNELS as readonly string[]).includes(input) ? (input as ReferralShareChannel) : 'link';
}

/** Why a code was not applied, in words a customer can act on. */
export const REFERRAL_REFUSAL_WORDS: Record<string, string> = {
  CODE_NOT_FOUND: 'That invite code was not found. Check it with the friend who sent it.',
  SELF_REFERRAL: 'You cannot use your own invite code.',
  ALREADY_REFERRED: 'Your account already has an invite code on it.',
  ALREADY_A_CUSTOMER: 'Invite codes are for new customers, before their first order is delivered.',
  PROGRAMME_DISABLED: 'Invites are paused at the moment, so the code was not added.',
  REFERRALS_OFF: 'Invites are paused at the moment, so the code was not added.',
};

export function referralRefusalWords(code: string | null | undefined): string {
  return (code && REFERRAL_REFUSAL_WORDS[code]) || 'The invite code could not be added.';
}

/** Why a held referral waits for a person (stored in held_reason). */
export type ReferralHoldReason = 'MONTHLY_LIMIT' | 'ORDER_TO_REFERRER_PHONE';
export const REFERRAL_HOLD_WORDS: Record<ReferralHoldReason, string> = {
  MONTHLY_LIMIT: 'More than the monthly number of friends paid for this customer',
  ORDER_TO_REFERRER_PHONE: "The friend's order went to the referrer's own phone number",
};

/** Where one invite stands, for the person who sent it. */
export type ReferralStage = 'joined' | 'ordered' | 'rewarded' | 'checking' | 'not_counted';

export function referralStage(r: { status: ReferralStatus; friendHasOrdered: boolean }): ReferralStage {
  if (r.status === 'awarded') return 'rewarded';
  if (r.status === 'held') return 'checking';
  if (r.status === 'rejected') return 'not_counted';
  return r.friendHasOrdered ? 'ordered' : 'joined';
}

export const REFERRAL_STAGE_WORDS: Record<ReferralStage, string> = {
  joined: 'Joined. Waiting for their first order',
  ordered: 'Ordered. You are paid when it is delivered',
  rewarded: 'Delivered. Points paid',
  checking: 'Being checked by our team',
  not_counted: 'Not counted',
};

/** "Sarah N." from a name; "A friend" when there is none. Never the email or the phone. */
export function friendDisplayName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A friend';
  const first = parts[0].slice(0, 20);
  const initial = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : '';
  return `${first[0].toUpperCase()}${first.slice(1)}${initial}`;
}
