/**
 * Customer identity stitching — the pure planning half (0155).
 *
 * Decides WHICH first-party keys a moment (sign-in, registration, an order)
 * may link to a canonical customer, in which order, and which of them are
 * strong enough to fold a guest profile into an account. The application use
 * case does the I/O; nothing here touches a database or a clock.
 *
 * Rules, each load-bearing:
 * - Deterministic keys only: the account id, a VERIFIED phone, an email, the
 *   order itself, and the server-issued visitor ids. Names, addresses, devices
 *   and "looks similar" never link anything.
 * - Only a verified proof may fold a guest profile into an account: a phone
 *   with phone_verified_at, or an email the identity provider verified. A
 *   typed phone or email links (CONTACT_*) but a clash with another customer
 *   is a CONFLICT for a person, never a merge. RegisterCustomerUseCase states
 *   why: typing someone else's number must not hand you their history.
 * - Visitor ids (experience profile, `_fp_cid`) are behavioural data. They are
 *   linked only when the person has not refused personalisation, and they
 *   never choose which customer an order belongs to (a shared phone or laptop
 *   would otherwise glue two people together).
 * - Emails and phones are HASHED (keyed HMAC) before they become identifier
 *   keys; the raw value never lands in customer_identity_links.
 */
import { normalizeUgandanPhone } from '@goldplus/shared';
import type { IdentitySignalType } from './CustomerIdentity';

export type StitchMoment =
  | 'SIGN_IN'
  | 'REGISTRATION'
  | 'SOCIAL_SIGN_IN'
  | 'VISITOR_LINK'
  | 'ORDER_PLACED'
  /** 0157: the account's phone was just verified (OTP): the proof that may fold a guest profile. */
  | 'PHONE_VERIFIED'
  | 'BACKFILL';

export const STITCH_MOMENTS: readonly StitchMoment[] = ['SIGN_IN', 'REGISTRATION', 'SOCIAL_SIGN_IN', 'VISITOR_LINK', 'ORDER_PLACED', 'PHONE_VERIFIED', 'BACKFILL'];

export interface StitchFacts {
  moment: StitchMoment;
  accountUserId?: string | null;
  accountEmail?: string | null;
  /** True only when an identity provider verified the email (social sign-in). */
  accountEmailVerified?: boolean;
  accountPhone?: string | null;
  /** True only when users.phone_verified_at is set. */
  accountPhoneVerified?: boolean;
  /** Contact typed at checkout. */
  contactEmail?: string | null;
  contactPhone?: string | null;
  orderId?: string | null;
  /** Server-resolved experience profile id (from the HttpOnly visit token). */
  experienceProfileId?: string | null;
  /** The server-set `_fp_cid` visitor id. */
  fpClientId?: string | null;
}

export type SignalCategory = 'ACCOUNT' | 'VERIFIED_CONTACT' | 'CONTACT' | 'ORDER' | 'VISITOR';

export interface PlannedSignal {
  signalType: IdentitySignalType;
  category: SignalCategory;
  /** The normalised value. For EMAIL/PHONE kinds it must be hashed before use. */
  value: string;
  valueKind: 'RAW_KEY' | 'EMAIL' | 'PHONE';
  /** May prove that a guest profile holding the same contact is this account. */
  mayFoldGuest: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Same shape the web middleware mints: `fp.<ms>.<uuid>`. */
const FP_CLIENT_ID = /^fp\.\d{10,16}\.[0-9a-f-]{36}$/;

export const VISITOR_PROFILE_PREFIX = 'xp:';
export const VISITOR_FP_PREFIX = 'fp:';
export const ORDER_KEY_PREFIX = 'order:';

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/** Lower-cased, trimmed email, or null when it is not an email at all. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_SHAPE.test(e)) return null;
  return e;
}

/**
 * Ugandan number to E.164 (+256XXXXXXXXX). Accepts every shape the users
 * column is known to hold (0771…, 256771…, +256771…, and the bare 771…).
 * Anything else is null: a foreign or malformed number never becomes a key.
 */
export function normalisePhoneE164(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.replace(/[\s\-().]/g, '');
  const direct = normalizeUgandanPhone(compact);
  if (direct) return direct.e164;
  if (/^7\d{8}$/.test(compact)) return normalizeUgandanPhone(`0${compact}`)?.e164 ?? null;
  return null;
}

export function isValidFpClientId(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length <= 120 && FP_CLIENT_ID.test(raw);
}

export const visitorProfileKey = (profileId: string) => `${VISITOR_PROFILE_PREFIX}${profileId}`;
export const visitorFpKey = (fpClientId: string) => `${VISITOR_FP_PREFIX}${fpClientId}`;
export const orderKey = (orderId: string) => `${ORDER_KEY_PREFIX}${orderId}`;

/**
 * The ordered list of keys a moment may link. Order is precedence: the first
 * key that already belongs to a customer anchors a guest's links.
 */
export function planIdentityStitch(f: StitchFacts): { signals: PlannedSignal[]; rejected: string[] } {
  const signals: PlannedSignal[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  const push = (s: PlannedSignal) => {
    const k = `${s.signalType}|${s.value}`;
    if (seen.has(k)) return;
    seen.add(k);
    signals.push(s);
  };

  const account = f.accountUserId ?? null;
  if (account !== null) {
    if (isUuid(account)) push({ signalType: 'AUTHENTICATED_CUSTOMER_ID', category: 'ACCOUNT', value: account, valueKind: 'RAW_KEY', mayFoldGuest: false });
    else rejected.push('ACCOUNT_ID_MALFORMED');
  }

  const accountPhone = normalisePhoneE164(f.accountPhone);
  const accountEmail = normaliseEmail(f.accountEmail);
  // Verified proofs exist only for a signed-in account.
  if (account && isUuid(account)) {
    if (accountPhone && f.accountPhoneVerified) push({ signalType: 'VERIFIED_PHONE', category: 'VERIFIED_CONTACT', value: accountPhone, valueKind: 'PHONE', mayFoldGuest: true });
    if (accountEmail && f.accountEmailVerified) push({ signalType: 'VERIFIED_EMAIL', category: 'VERIFIED_CONTACT', value: accountEmail, valueKind: 'EMAIL', mayFoldGuest: true });
  }
  if (f.accountPhone && !accountPhone) rejected.push('ACCOUNT_PHONE_NOT_UGANDAN_E164');
  if (f.accountEmail && !accountEmail) rejected.push('ACCOUNT_EMAIL_MALFORMED');

  const contactEmail = normaliseEmail(f.contactEmail);
  const contactPhone = normalisePhoneE164(f.contactPhone);
  if (f.contactEmail && !contactEmail) rejected.push('CONTACT_EMAIL_MALFORMED');
  if (f.contactPhone && !contactPhone) rejected.push('CONTACT_PHONE_NOT_UGANDAN_E164');

  // Every typed contact is also linked as CONTACT_*, verified or not: that is
  // the key a guest checkout with the same contact will look up.
  for (const email of [accountEmail, contactEmail]) {
    if (email) push({ signalType: 'CONTACT_EMAIL', category: 'CONTACT', value: email, valueKind: 'EMAIL', mayFoldGuest: false });
  }
  for (const phone of [accountPhone, contactPhone]) {
    if (phone) push({ signalType: 'CONTACT_PHONE', category: 'CONTACT', value: phone, valueKind: 'PHONE', mayFoldGuest: false });
  }

  if (f.orderId) {
    if (isUuid(f.orderId)) push({ signalType: 'ORDER_CUSTOMER_RELATIONSHIP', category: 'ORDER', value: orderKey(f.orderId), valueKind: 'RAW_KEY', mayFoldGuest: false });
    else rejected.push('ORDER_ID_MALFORMED');
  }

  if (f.experienceProfileId) {
    if (isUuid(f.experienceProfileId)) push({ signalType: 'STABLE_ANONYMOUS_ID', category: 'VISITOR', value: visitorProfileKey(f.experienceProfileId), valueKind: 'RAW_KEY', mayFoldGuest: false });
    else rejected.push('VISITOR_PROFILE_MALFORMED');
  }
  if (f.fpClientId) {
    if (isValidFpClientId(f.fpClientId)) push({ signalType: 'STABLE_ANONYMOUS_ID', category: 'VISITOR', value: visitorFpKey(f.fpClientId), valueKind: 'RAW_KEY', mayFoldGuest: false });
    else rejected.push('VISITOR_FP_MALFORMED');
  }

  return { signals, rejected };
}

/** The guest-matching counterpart of a verified proof (same hash, typed-contact signal). */
export function counterpartOf(signalType: IdentitySignalType): IdentitySignalType | null {
  if (signalType === 'VERIFIED_PHONE') return 'CONTACT_PHONE';
  if (signalType === 'VERIFIED_EMAIL') return 'CONTACT_EMAIL';
  return null;
}

export interface AnchorCandidate {
  category: SignalCategory;
  canonicalCustomerId: string | null;
  /** The owning profile has been folded into another; it can anchor nothing. */
  merged?: boolean;
}

/**
 * The customer a GUEST's links attach to: the first existing owner among the
 * non-visitor keys, in plan order. Visitor ids never anchor.
 */
export function chooseGuestAnchor(candidates: AnchorCandidate[]): string | null {
  for (const c of candidates) {
    if (c.category === 'VISITOR' || c.category === 'ACCOUNT') continue;
    if (c.canonicalCustomerId && !c.merged) return c.canonicalCustomerId;
  }
  return null;
}

/**
 * May a guest profile be folded into this account's profile? Only on a
 * verified proof, only a GUEST (a profile owned by another account is two
 * people, or one person with two accounts — a person decides), and never into
 * itself.
 */
export function mayFoldGuestProfile(input: {
  proof: PlannedSignal;
  guestCanonicalId: string;
  guestHasAccount: boolean;
  guestMerged: boolean;
  intoCanonicalId: string;
}): boolean {
  return input.proof.mayFoldGuest
    && !input.guestHasAccount
    && !input.guestMerged
    && input.guestCanonicalId !== input.intoCanonicalId;
}
