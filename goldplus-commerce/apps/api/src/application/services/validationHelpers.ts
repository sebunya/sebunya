/**
 * Every helper here receives what a PUBLIC form sent, and a public form sends
 * whatever the caller typed into the JSON — a number, an array, an object. Each
 * helper's contract is "a string, or nothing"; anything else is treated as
 * nothing, so a `{"email": 12345}` body is a validation failure (400) and not
 * a TypeError on `.trim()` (500). Proven live on 2026-09-12 against
 * /governance/quotes/request and /governance/support/*.
 */
const str = (val: unknown): string => (typeof val === 'string' ? val : '');

/** The caller-typed field as trimmed text; anything that is not a string is ''. */
export function text(val: unknown): string {
  return str(val).trim();
}

/**
 * Centralized server-side validation logic for GoldPlus.
 * Enforces complete logic parity with frontend validation rules.
 */

export function isNonEmpty(val: unknown): boolean {
  return typeof val === 'string' && val.trim().length > 0;
}

export function isMinLength(val: unknown, len: number): boolean {
  const v = str(val);
  if (!v) return false;
  return v.trim().length >= len;
}

export function isMaxLength(val: unknown, len: number): boolean {
  const v = str(val);
  if (!v) return true; // Optional fields pass max length if empty
  return v.trim().length <= len;
}

export function isValidEmail(val: unknown): boolean {
  const v = str(val);
  if (!v) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(v.trim());
}

export function isValidUgandanPhone(val: unknown): boolean {
  const v = str(val);
  if (!v) return false;
  const clean = v.replace(/\s+/g, '').replace(/\+/g, '');
  if (!/^\d+$/.test(clean)) return false;

  if (clean.length === 9 && clean.startsWith('7')) return true;
  if (clean.length === 10 && clean.startsWith('07')) return true;
  if (clean.length === 12 && clean.startsWith('2567')) return true;

  return false;
}

export function normalizePhone(val: unknown): string {
  const v = str(val);
  if (!v) return '';
  if (!isValidUgandanPhone(v)) return v.trim();
  const clean = v.replace(/\s+/g, '').replace(/\+/g, '');
  if (clean.length === 9) return `+256${clean}`;
  if (clean.length === 10) return `+256${clean.substring(1)}`;
  if (clean.length === 12) return `+${clean}`;
  return v.trim();
}

export function normalizeEmail(val: unknown): string {
  return str(val).trim().toLowerCase();
}

export function isHttpsUrl(val: unknown): boolean {
  const v = str(val);
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}
