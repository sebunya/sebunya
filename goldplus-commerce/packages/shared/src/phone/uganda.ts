/**
 * Ugandan phone normalisation (location-module brief PART G, field 3).
 *
 * Accepts 07XXXXXXXX, +2567XXXXXXXX, 2567XXXXXXXX and the same with spaces or
 * hyphens; normalises to E.164 (+256…). Validates SHAPE strictly. There is
 * no operator-prefix check (see below).
 */

export interface NormalisedUgandanPhone {
  e164: string;
  /** set when the shape is valid but the operator prefix is not a known allocation */
  warning: string | null;
}

export function normalizeUgandanPhone(raw: string | null | undefined): NormalisedUgandanPhone | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s\-().]/g, '');
  let national: string | null = null;

  if (/^\+256\d{9}$/.test(digits)) national = digits.slice(4);
  else if (/^256\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else return null;

  if (!/^\d{9}$/.test(national)) return null;
  // No operator-prefix warning: every 07X prefix (70-79) was on the "known"
  // list, so the warning could never fire. It was dead code, not a check. The
  // field stays for callers; it is null until a real allocation list exists.
  const warning: string | null = null;
  return { e164: `+256${national}`, warning };
}

/**
 * Which mobile money network a Ugandan mobile number belongs to, for a HINT
 * only (2026-10-16). Two live payments failed because an Airtel number (0705…)
 * was charged over MTN's rails; telling the customer which network to pick on
 * the payment form prevents that. Only allocations we are sure of are named;
 * anything else returns null and no hint is shown. Number portability does not
 * exist in Uganda, so the prefix decides the network.
 */
export type MobileMoneyNetwork = 'MTN' | 'Airtel';
const NETWORK_BY_PREFIX: Readonly<Record<string, MobileMoneyNetwork>> = {
  '70': 'Airtel', '74': 'Airtel', '75': 'Airtel',
  '76': 'MTN', '77': 'MTN', '78': 'MTN',
};
export function mobileMoneyNetworkFor(raw: string | null | undefined): MobileMoneyNetwork | null {
  const n = normalizeUgandanPhone(raw);
  if (!n) return null;
  return NETWORK_BY_PREFIX[n.e164.slice(4, 6)] ?? null;
}
