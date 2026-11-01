import type { AstroCookies } from 'astro';

/**
 * Invite links (2026-10-22). A friend opens /r/<code>: the code is remembered in this browser for 60 days, so it is
 * not lost when they look around first, come back later, or sign up with Google or Facebook. The first time they are
 * signed in (any way of signing up), the middleware adds the code to their account once and forgets it.
 */
export const INVITE_COOKIE = 'gp_ref';
/** A random id for this browser, so a link opened twice by one person counts one person (only its hash is stored). */
export const INVITE_VISITOR_COOKIE = 'gp_ref_v';
/** One message for the next page: 'applied' or why the code was not added. */
export const INVITE_NOTE_COOKIE = 'gp_ref_note';
export const INVITE_DAYS = 60;

/** The same shape rule as the API (domain/loyalty/Referral normaliseReferralCode). */
export function normaliseInviteCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

export function rememberedInvite(cookies: AstroCookies): string | null {
  return normaliseInviteCode(cookies.get(INVITE_COOKIE)?.value);
}

export function rememberInvite(cookies: AstroCookies, code: string, secure: boolean): void {
  cookies.set(INVITE_COOKIE, code, { path: '/', maxAge: 60 * 60 * 24 * INVITE_DAYS, sameSite: 'lax', httpOnly: true, secure });
}

export function forgetInvite(cookies: AstroCookies): void {
  cookies.delete(INVITE_COOKIE, { path: '/' });
}

export function setInviteNote(cookies: AstroCookies, note: string, secure: boolean): void {
  cookies.set(INVITE_NOTE_COOKIE, note.replace(/[^A-Z_a-z]/g, '').slice(0, 30), { path: '/', maxAge: 600, sameSite: 'lax', httpOnly: true, secure });
}

/** Link previews (WhatsApp, Facebook, Telegram, X, Slack) fetch the link to draw a card: not a person opening it. */
export function isLinkPreviewAgent(userAgent: string | null | undefined): boolean {
  return /whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|googlebot|bingbot|bot\b|crawler|spider|preview/i.test(userAgent ?? '');
}

/** What the customer reads about their invite, once, on the page after it was added or refused. */
export function inviteNoteWords(note: string | null | undefined, refereePoints: number | null = null): { kind: 'success' | 'info'; text: string } | null {
  if (!note) return null;
  if (note === 'applied') {
    return { kind: 'success', text: refereePoints
      ? `Your friend's invite is on your account. You get ${refereePoints.toLocaleString('en-UG')} points when your first order is delivered.`
      : "Your friend's invite is on your account. Your welcome points arrive with your first delivered order." };
  }
  const words: Record<string, string> = {
    CODE_NOT_FOUND: 'That invite code was not found, so it was not added. Check it with the friend who sent it.',
    SELF_REFERRAL: 'That is your own invite code, so it was not added.',
    ALREADY_A_CUSTOMER: 'Invite codes are for new customers, before their first order is delivered, so it was not added.',
    PROGRAMME_DISABLED: 'Invites are paused at the moment, so the code was not added.',
    REFERRALS_OFF: 'Invites are paused at the moment, so the code was not added.',
    ALREADY_REFERRED: 'Your account already has an invite on it.',
    UNAVAILABLE: 'The invite code could not be added just now. Please try again in a moment.',
  };
  return words[note] ? { kind: 'info', text: words[note] } : null;
}
