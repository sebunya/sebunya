/**
 * Ugandan phone normalisation (location-module brief PART G, field 3).
 *
 * Accepts 07XXXXXXXX, +2567XXXXXXXX, 2567XXXXXXXX and the same with spaces or
 * hyphens; normalises to E.164 (+256…). Validates SHAPE strictly; an
 * unrecognised operator prefix WARNS but never blocks — operator allocations
 * change and a hard allowlist rots.
 */

export interface NormalisedUgandanPhone {
  e164: string;
  /** set when the shape is valid but the operator prefix is not a known allocation */
  warning: string | null;
}

// Known mobile prefixes (informational only — drives the warning, never a block).
const KNOWN_PREFIXES = new Set([
  '70', '74', '75', '76', '77', '78', '79', // MTN / Airtel / Lyca / Smile eras
  '71', '72', '73',
]);

export function normalizeUgandanPhone(raw: string | null | undefined): NormalisedUgandanPhone | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s\-().]/g, '');
  let national: string | null = null;

  if (/^\+256\d{9}$/.test(digits)) national = digits.slice(4);
  else if (/^256\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else return null;

  if (!/^\d{9}$/.test(national)) return null;
  // Mobile numbers are 7XXXXXXXX; landlines (4XX, 3XX…) are accepted too — a
  // rider can be called on either — but only mobiles get prefix intelligence.
  const isMobile = national.startsWith('7');
  const prefix = national.slice(0, 2);
  const warning =
    isMobile && !KNOWN_PREFIXES.has(prefix)
      ? `Prefix 0${prefix} is not a recognised Ugandan mobile allocation — double-check the number.`
      : null;
  return { e164: `+256${national}`, warning };
}
