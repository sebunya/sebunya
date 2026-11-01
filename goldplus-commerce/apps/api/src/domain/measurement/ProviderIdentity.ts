import { createHash } from 'node:crypto';

/**
 * Provider match-identity (§8 measurement). Pure domain.
 *
 * Providers (Meta CAPI, TikTok Events, WhatsApp, SMS) match customers on HASHED
 * identifiers. Two rules make this safe and truthful:
 *   1. A phone is normalised to E.164 before hashing — the SAME number written
 *      "0700 123456", "+256700123456" or "256700123456" must hash identically,
 *      or match quality silently collapses.
 *   2. Only an allowlisted set of hashed fields is ever emitted, only when
 *      consent is granted, and RAW PII never leaves this function. There is no
 *      send here — this builds a readiness payload, nothing more.
 */

const DIGITS = /\D+/g;

/**
 * Normalise a Ugandan mobile number to E.164 (+256XXXXXXXXX), or null if it is
 * not a recognisable Ugandan mobile. Handles +, 00, 256, and 0-prefixes and
 * strips spaces/dashes/parentheses.
 */
export function toE164Uganda(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // International escape prefixes -> nothing; keep a leading + only to detect it.
  const hadPlus = s.startsWith('+');
  let digits = s.replace(DIGITS, '');
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2); // 00256...
  // Now `digits` is only digits.
  let national: string | null = null;
  if (digits.length === 12 && digits.startsWith('256')) national = digits.slice(3);
  else if (digits.length === 9) national = digits; // 7XXXXXXXX
  else if (digits.length === 10 && digits.startsWith('0')) national = digits.slice(1); // 07XXXXXXXX
  else if (digits.length === 11 && digits.startsWith('256')) national = null; // 256 + 8 digits = invalid
  else national = null;

  // A Ugandan mobile national number is 9 digits starting 7 (MTN/Airtel) or 3/4
  // for some ranges; require 9 digits and a leading 7 for mobile.
  if (national && national.length === 9 && national.startsWith('7')) {
    return `+256${national}`;
  }
  return null;
}

/** Lowercase + trim an email for stable hashing. Null if empty/blatantly invalid. */
export function normaliseEmailForHash(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/** SHA-256 hex of an already-normalised value. */
export function hashIdentifier(normalised: string): string {
  return createHash('sha256').update(normalised).digest('hex');
}

export type ProviderMatchField = 'em' | 'ph';

export interface MatchIdentityInput {
  email?: string | null;
  phone?: string | null;
  consentGranted: boolean;
}

export interface MatchIdentityResult {
  /** Hashed identifiers, only for allowlisted fields, only with consent. */
  identifiers: Partial<Record<ProviderMatchField, string>>;
  /** Fields dropped because they were absent, invalid, or not allowlisted. */
  dropped: string[];
  consentBlocked: boolean;
  /** 0..1 — how many of the allowlisted fields we could populate. */
  matchQuality: number;
}

/**
 * Build the hashed match identifiers for a provider. `allowlist` is the set of
 * fields THIS provider is permitted to receive; anything else is dropped even if
 * present. Without consent, nothing is emitted.
 */
export function buildMatchIdentity(
  input: MatchIdentityInput,
  allowlist: readonly ProviderMatchField[],
): MatchIdentityResult {
  if (!input.consentGranted) {
    return { identifiers: {}, dropped: ['all (no consent)'], consentBlocked: true, matchQuality: 0 };
  }
  const allow = new Set(allowlist);
  const identifiers: Partial<Record<ProviderMatchField, string>> = {};
  const dropped: string[] = [];

  const email = normaliseEmailForHash(input.email);
  if (allow.has('em')) {
    if (email) identifiers.em = hashIdentifier(email);
    else dropped.push('em (missing/invalid)');
  } else if (input.email) {
    dropped.push('em (not allowlisted for this provider)');
  }

  const phone = toE164Uganda(input.phone);
  if (allow.has('ph')) {
    if (phone) identifiers.ph = hashIdentifier(phone);
    else dropped.push('ph (missing/invalid)');
  } else if (input.phone) {
    dropped.push('ph (not allowlisted for this provider)');
  }

  const populated = Object.keys(identifiers).length;
  const matchQuality = allow.size ? populated / allow.size : 0;
  return { identifiers, dropped, consentBlocked: false, matchQuality };
}
