/**
 * Password policy for customer accounts.
 *
 * Deliberately explainable: at least 8 characters with at least one
 * letter and one digit. Admin bootstrap enforces its own stricter
 * minimum (12) in scripts/bootstrap-admin.ts.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export type PasswordValidation = { ok: true } | { ok: false; message: string };

export function validatePassword(password: string): PasswordValidation {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { ok: false, message: 'Password must contain at least one letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, message: 'Password must contain at least one digit.' };
  }
  return { ok: true };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return typeof email === 'string' && email.length <= 255 && EMAIL_PATTERN.test(email);
}
