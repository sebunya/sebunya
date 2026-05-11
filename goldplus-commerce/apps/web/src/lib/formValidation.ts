/**
 * Centralized client-side validation logic for GoldPlus Commerce forms.
 * Used in Astro templates to provide feedback prior to network serialization.
 */

export function isNonEmpty(val: string): boolean {
  return typeof val === 'string' && val.trim().length > 0;
}

export function isMinLength(val: string, len: number): boolean {
  return typeof val === 'string' && val.trim().length >= len;
}

export function isMaxLength(val: string, len: number): boolean {
  return typeof val === 'string' && val.trim().length <= len;
}

export function isValidEmail(val: string): boolean {
  if (!val) return false;
  // Basic practical RFC-like test without crazy overhead
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(val.trim());
}

/**
 * Handles Ugandan phone patterns: 07XXXXXXXX, 2567XXXXXXXX, +2567XXXXXXXX.
 */
export function isValidUgandanPhone(val: string): boolean {
  if (!val) return false;
  const clean = val.replace(/\s+/g, '').replace(/\+/g, '');
  // Must be all digits
  if (!/^\d+$/.test(clean)) return false;

  // Options: 9 digits (700000000), 10 digits (0700000000), 12 digits (256700000000)
  if (clean.length === 9 && clean.startsWith('7')) return true;
  if (clean.length === 10 && clean.startsWith('07')) return true;
  if (clean.length === 12 && clean.startsWith('2567')) return true;

  return false;
}

export function normalizePhone(val: string): string {
  if (!isValidUgandanPhone(val)) return val.trim();
  const clean = val.replace(/\s+/g, '').replace(/\+/g, '');
  if (clean.length === 9) return `+256${clean}`;
  if (clean.length === 10) return `+256${clean.substring(1)}`;
  if (clean.length === 12) return `+${clean}`;
  return val.trim();
}

export function normalizeEmail(val: string): string {
  return (val || '').trim().toLowerCase();
}

export function isHttpsUrl(val: string): boolean {
  if (!val) return false;
  try {
    const u = new URL(val);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface FileValidationError {
  file: string;
  message: string;
}

export function validateImageFile(file: File): string | null {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (!allowedMimes.includes(file.type)) {
    return 'Must be a valid image (JPG, PNG, WEBP).';
  }
  if (file.size > maxSize) {
    return 'Maximum file size is 5MB.';
  }
  return null;
}
