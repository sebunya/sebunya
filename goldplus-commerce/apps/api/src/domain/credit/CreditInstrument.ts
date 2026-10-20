/**
 * Store credit and gift cards as a TENDER (gap analysis #17, 2026-10-20).
 *
 * Not a promotion: the pricing evaluator never discounts a line below its floor and does not discount an
 * unfloored product at all, so credit expressed as a discount would often be worth nothing. A credit instead pays
 * part (or all) of an order, beside Pesapal, like money.
 *
 * One model for both kinds. An INSTRUMENT is a bearer code with a balance; the balance is never stored, it is the
 * sum of an append-only ledger. A hold reserves money against an order while it is being paid; it is captured
 * when the order is paid and released when the payment fails, the order is cancelled or the hold expires. A
 * refund of an order returns what credit paid to the same instrument.
 *
 * Pure: no database, no clock of its own, no randomness of its own.
 */

export type CreditKind = 'gift_card' | 'store_credit';

export type LedgerEntryType =
  | 'ISSUE' //        + money put on the instrument (sold, or given as a refund/goodwill)
  | 'HOLD' //         - reserved against one order; becomes CAPTURED or RELEASED
  | 'RETURN' //       + an order refund giving back what credit paid
  | 'ADJUST' //       ± a staff correction with a reason
  | 'VOID'; //        - the rest of the balance cancelled (lost/stolen card, issued in error)

export type HoldState = 'held' | 'captured' | 'released';

export interface LedgerEntry {
  type: LedgerEntryType;
  /** Signed UGX: positive adds to the balance, negative takes from it. */
  amountUgx: number;
  /** Holds only. A released hold no longer counts. */
  holdState?: HoldState;
}

/** Spendable balance: everything except released holds. A captured hold is spent; a held one is reserved. */
export function availableBalance(entries: readonly LedgerEntry[]): number {
  let total = 0;
  for (const e of entries) {
    if (e.type === 'HOLD' && e.holdState === 'released') continue;
    total += e.amountUgx;
  }
  return Math.max(0, total);
}

/** How much credit an order may take: never more than the balance, never more than what is owed. */
export function creditToApply(input: { balanceUgx: number; amountDueUgx: number; requestedUgx?: number | null }): number {
  const cap = Math.max(0, Math.min(input.balanceUgx, input.amountDueUgx));
  if (input.requestedUgx === null || input.requestedUgx === undefined) return cap;
  return Math.max(0, Math.min(cap, Math.floor(input.requestedUgx)));
}

// ── Codes ─────────────────────────────────────────────────────────────────
// Crockford base32 without I, L, O, U (no 1/I, 0/O mix-ups when read over the phone or typed from a card).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX: Record<CreditKind, string> = { gift_card: 'GPGC', store_credit: 'GPSC' };

function checkChar(body: string): string {
  // Weighted sum mod 32: catches any single wrong character and most swaps of two neighbours.
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += (ALPHABET.indexOf(body[i]) + 1) * (i + 1);
  return ALPHABET[sum % 32];
}

/**
 * A new code from 11 random symbols (55 bits) and one check symbol: GPGC-XXXX-XXXX-XXXX. `randomIndexes` must come
 * from a cryptographic source (infrastructure passes crypto.randomInt); the domain only shapes it.
 */
export function newCreditCode(kind: CreditKind, randomIndexes: readonly number[]): string {
  if (randomIndexes.length < 11) throw new Error('newCreditCode needs 11 random indexes');
  const body = randomIndexes.slice(0, 11).map((n) => ALPHABET[((n % 32) + 32) % 32]).join('');
  const full = body + checkChar(body);
  return `${PREFIX[kind]}-${full.slice(0, 4)}-${full.slice(4, 8)}-${full.slice(8, 12)}`;
}

/** The canonical form of what a customer typed, or null when it is not a well-formed code (wrong check symbol too). */
export function normalizeCreditCode(typed: unknown): { code: string; kind: CreditKind } | null {
  if (typeof typed !== 'string') return null;
  const clean = typed.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const m = /^(GPGC|GPSC)([0-9A-HJKMNP-TV-Z]{12})$/.exec(clean);
  if (!m) return null;
  const full = m[2];
  if (checkChar(full.slice(0, 11)) !== full[11]) return null;
  const kind: CreditKind = m[1] === 'GPGC' ? 'gift_card' : 'store_credit';
  return { code: `${m[1]}-${full.slice(0, 4)}-${full.slice(4, 8)}-${full.slice(8, 12)}`, kind };
}

/** What staff and customers see after issue: never the whole code. */
export function maskCreditCode(code: string): string {
  return `${code.slice(0, 4)}-••••-••••-${code.slice(-4)}`;
}

// ── Issue rules ───────────────────────────────────────────────────────────
export const MAX_INSTRUMENT_VALUE_UGX = 5_000_000;
/** Above this, a second staff member must approve before the instrument can be spent (like large promotions). */
export const SECOND_APPROVAL_ABOVE_UGX = 500_000;
/** A hold not captured within this time is released by the sweep (an abandoned payment must not lock money). */
export const HOLD_TTL_MS = 2 * 60 * 60 * 1000;

export type IssueCheck = { ok: true; needsSecondApproval: boolean } | { ok: false; code: 'BAD_AMOUNT' | 'TOO_LARGE' | 'NEEDS_REASON' };

export function checkIssue(input: { amountUgx: number; reason: string }): IssueCheck {
  if (!Number.isInteger(input.amountUgx) || input.amountUgx < 1_000) return { ok: false, code: 'BAD_AMOUNT' };
  if (input.amountUgx > MAX_INSTRUMENT_VALUE_UGX) return { ok: false, code: 'TOO_LARGE' };
  if (input.reason.trim().length < 5) return { ok: false, code: 'NEEDS_REASON' };
  return { ok: true, needsSecondApproval: input.amountUgx > SECOND_APPROVAL_ABOVE_UGX };
}
