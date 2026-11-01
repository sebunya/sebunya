/**
 * A customer's own data requests (0157, docs/first-party/README.md). Pure
 * policy: which request may be made, which may be carried out, and what an
 * erased record reads as afterwards.
 *
 * - EXPORT: the signed-in customer downloads their data at once. Recorded, not
 *   queued. At most EXPORTS_PER_DAY a day, so a stolen session cannot be used
 *   to scrape repeatedly without it showing.
 * - ANONYMISE_HISTORY: personal details are removed from past orders, quotes,
 *   battery requests and support tickets, and browsers are unlinked; the account
 *   itself stays (sign-in, points).
 * - DELETE_ACCOUNT: all of the above, and the account is closed: its email,
 *   phone, password, birthday and saved addresses are removed and every session
 *   ends. Order records are KEPT, without personal details, because sales
 *   records must be retained for tax and accounting; the amounts stay.
 *
 * Both erasures are carried out by a person in admin, never automatically, and
 * never while an order is still open (the delivery needs the contact).
 */

export const PRIVACY_REQUEST_KINDS = ['EXPORT', 'ANONYMISE_HISTORY', 'DELETE_ACCOUNT'] as const;
export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number];
export const ERASURE_KINDS: readonly PrivacyRequestKind[] = ['ANONYMISE_HISTORY', 'DELETE_ACCOUNT'];

export type PrivacyRequestStatus = 'RECEIVED' | 'COMPLETED' | 'DECLINED' | 'WITHDRAWN';

export const EXPORTS_PER_DAY = 5;

/** What an erased free-text field reads as. */
export const REMOVED_TEXT = 'Removed at the customer\'s request';

/** Order states in which the delivery still needs the customer's contact. */
const CLOSED_ORDER_STATUSES = new Set(['delivered', 'completed', 'cancelled', 'failed', 'refunded', 'returned', 'expired', 'abandoned']);

export function isOpenOrder(status: string): boolean {
  return !CLOSED_ORDER_STATUSES.has(String(status ?? '').toLowerCase());
}

export function isPrivacyRequestKind(v: unknown): v is PrivacyRequestKind {
  return typeof v === 'string' && (PRIVACY_REQUEST_KINDS as readonly string[]).includes(v);
}

export function mayRequestExport(exportsInLast24h: number): { ok: true } | { ok: false; code: 'EXPORT_LIMIT' } {
  return exportsInLast24h >= EXPORTS_PER_DAY ? { ok: false, code: 'EXPORT_LIMIT' } : { ok: true };
}

/** Can a person carry this erasure out now? */
export function mayFulfilErasure(input: { status: PrivacyRequestStatus; kind: PrivacyRequestKind; openOrders: number; confirmation: string; reference: string }):
  | { ok: true }
  | { ok: false; code: 'NOT_OPEN' | 'NOT_AN_ERASURE' | 'CONFIRMATION_MISMATCH' | 'OPEN_ORDERS' } {
  if (input.status !== 'RECEIVED') return { ok: false, code: 'NOT_OPEN' };
  if (!ERASURE_KINDS.includes(input.kind)) return { ok: false, code: 'NOT_AN_ERASURE' };
  if (input.confirmation.trim().toUpperCase() !== input.reference.toUpperCase()) return { ok: false, code: 'CONFIRMATION_MISMATCH' };
  if (input.openOrders > 0) return { ok: false, code: 'OPEN_ORDERS' };
  return { ok: true };
}

const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** PR-XXXXXX from six random bytes (the caller supplies them; tests can too). */
export function privacyReference(bytes: Uint8Array): string {
  let out = 'PR-';
  for (let i = 0; i < 6; i++) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return out;
}

/** The address a closed account keeps (users.email is NOT NULL and unique). Not deliverable: .invalid is reserved (RFC 2606). */
export function erasedEmailFor(userId: string): string {
  return `erased-${userId.replace(/-/g, '').slice(0, 16)}@erased.invalid`;
}

/** Customer-facing wording for each kind. */
export const PRIVACY_KIND_LABEL: Record<PrivacyRequestKind, string> = {
  EXPORT: 'Download my data',
  ANONYMISE_HISTORY: 'Remove my details from past orders',
  DELETE_ACCOUNT: 'Delete my account',
};
