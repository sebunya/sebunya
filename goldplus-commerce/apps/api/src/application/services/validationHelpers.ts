/**
 * Centralized server-side validation logic for GoldPlus.
 * Enforces complete logic parity with frontend validation rules.
 */

export function isNonEmpty(val: string | null | undefined): boolean {
  return typeof val === 'string' && val.trim().length > 0;
}

export function isMinLength(val: string | null | undefined, len: number): boolean {
  if (!val) return false;
  return val.trim().length >= len;
}

export function isMaxLength(val: string | null | undefined, len: number): boolean {
  if (!val) return true; // Optional fields pass max length if empty
  return val.trim().length <= len;
}

export function isValidEmail(val: string | null | undefined): boolean {
  if (!val) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(val.trim());
}

export function isValidUgandanPhone(val: string | null | undefined): boolean {
  if (!val) return false;
  const clean = val.replace(/\s+/g, '').replace(/\+/g, '');
  if (!/^\d+$/.test(clean)) return false;

  if (clean.length === 9 && clean.startsWith('7')) return true;
  if (clean.length === 10 && clean.startsWith('07')) return true;
  if (clean.length === 12 && clean.startsWith('2567')) return true;

  return false;
}

export function normalizePhone(val: string | null | undefined): string {
  if (!val) return '';
  if (!isValidUgandanPhone(val)) return val.trim();
  const clean = val.replace(/\s+/g, '').replace(/\+/g, '');
  if (clean.length === 9) return `+256${clean}`;
  if (clean.length === 10) return `+256${clean.substring(1)}`;
  if (clean.length === 12) return `+${clean}`;
  return val.trim();
}

export function normalizeEmail(val: string | null | undefined): string {
  return (val || '').trim().toLowerCase();
}

export function isHttpsUrl(val: string | null | undefined): boolean {
  if (!val) return false;
  try {
    const u = new URL(val);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}
