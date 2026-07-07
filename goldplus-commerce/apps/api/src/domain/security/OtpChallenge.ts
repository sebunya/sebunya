import { randomInt } from 'node:crypto';

/**
 * One-time passcode challenge rules (email/SMS 2FA and step-up).
 *
 * The code itself is never stored — only its hash (computed in infra).
 * This domain owns the state machine: expiry, single-use, and the
 * attempt cap that stops code-guessing brute force.
 */

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_SECONDS = 300; // 5 minutes
export const OTP_MAX_ATTEMPTS = 5;

export type OtpChannel = 'sms' | 'email';

export type OtpPurpose = 'login_2fa' | 'enroll_sms' | 'enroll_email' | 'step_up';

/** Cryptographically-random numeric code, zero-padded. */
export function generateOtpCode(length = OTP_CODE_LENGTH): string {
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, '0');
}

export interface OtpChallengeState {
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  maxAttempts: number;
}

export type OtpEvaluation =
  | { outcome: 'OK' }
  | { outcome: 'EXPIRED' | 'CONSUMED' | 'TOO_MANY_ATTEMPTS' | 'INVALID_CODE'; message: string };

/**
 * Evaluates a submitted code against challenge state. The caller supplies
 * `isMatch` (a constant-time hash comparison done in infra). Order matters:
 * consumed/expired/locked are checked before the match so a correct code
 * can't revive a dead challenge.
 */
export function evaluateOtp(state: OtpChallengeState, isMatch: boolean, now: Date = new Date()): OtpEvaluation {
  if (state.consumedAt) return { outcome: 'CONSUMED', message: 'This code has already been used.' };
  if (now.getTime() > state.expiresAt.getTime()) return { outcome: 'EXPIRED', message: 'This code has expired. Request a new one.' };
  if (state.attempts >= state.maxAttempts) {
    return { outcome: 'TOO_MANY_ATTEMPTS', message: 'Too many incorrect attempts. Request a new code.' };
  }
  if (!isMatch) return { outcome: 'INVALID_CODE', message: 'That code is incorrect.' };
  return { outcome: 'OK' };
}

export function otpExpiryFrom(now: Date = new Date(), ttlSeconds = OTP_TTL_SECONDS): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}

/** Masks a destination for safe display, e.g. "j***@x.com" / "+2567****123". */
export function maskDestination(channel: OtpChannel, destination: string): string {
  if (channel === 'email') {
    const [local, domain] = destination.split('@');
    if (!domain) return '***';
    const head = local.slice(0, 1);
    return `${head}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
  }
  const digits = destination.replace(/\s+/g, '');
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return `${digits.slice(0, 4)}${'*'.repeat(Math.max(digits.length - 7, 1))}${digits.slice(-3)}`;
}
