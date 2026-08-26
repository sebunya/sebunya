import { normalizeUgandanPhone } from '@goldplus/shared';
import { IUserRepository } from '../../ports/IUserRepository';
import { IPasswordHasher } from '../../ports/IPasswordHasher';
import { IAccountRecoveryRepository } from '../../ports/IAccountRecoveryRepository';
import {
  ILoyaltyIdentityRepository,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_COOLDOWN_MS,
} from '../loyalty/LoyaltyIdentityUseCases';
import { constantTimeEquals } from './PasswordResetUseCases';

/**
 * Password reset by SMS code.
 *
 * The link-based reset (PasswordResetUseCases) depends on email, and email has
 * never delivered from production. The phone is the account for most GoldPlus
 * customers, and SMS is the channel that is proven to arrive, so this is the
 * way back in that actually works.
 *
 * Rules, the same ones the link flow encodes, restated for a six digit code:
 *
 *  - NO USER ENUMERATION. The request endpoint answers identically for a phone
 *    that has an account and one that does not, and identically when throttled.
 *  - NOTHING DECRYPTABLE IS PERSISTED. The code lives in the SMS and in a hash.
 *    It is delivered synchronously, never written to the outbox, so no table
 *    ever holds a usable bearer secret.
 *  - The hash is DOMAIN SEPARATED from the phone verification code that shares
 *    the same table: a verification code can never pass as a reset code, and
 *    a reset code can never verify a phone.
 *  - A code works once, expires in ten minutes, and allows five wrong guesses.
 *    Issuing is bounded by the same cooldown and hourly cap as verification,
 *    so nobody can bill us for unlimited SMS or flood a handset.
 *  - A successful reset REVOKES EVERY SESSION and voids every outstanding
 *    email reset link. It also marks the phone verified: the customer has just
 *    proved control of it.
 *  - The generic answer says what was DONE, never that a message arrived.
 */

export const SMS_RESET_CODE_TTL_MINUTES = 10;
export const SMS_RESET_MAX_ATTEMPTS = 5;
const MIN_PASSWORD_LENGTH = 8;

/** Identical for every input, by design. */
export const GENERIC_SMS_RESET_ACKNOWLEDGEMENT =
  'If that number is on a GoldPlus account, we have sent it a 6 digit code by SMS. The code works once and expires in 10 minutes. If nothing arrives, check the number and ask again, or call us and we will get you back in.';

const CODE_INVALID_MESSAGE = 'That code is not correct or has expired. Ask for a new code and try again.';
const TOO_MANY_ATTEMPTS_MESSAGE = 'Too many wrong codes. Ask for a new code and try again.';

/**
 * Domain separation. `hash` is the same SHA-256 the phone verification flow
 * uses; the prefix is what keeps the two code spaces apart in one table.
 */
export const resetCodeHash = (hash: (v: string) => string, code: string): string => hash(`password-reset:${code}`);

export interface ResetCodeDeliveryPort {
  /**
   * Deliver the code NOW. Implementations must not queue it: a queued code is a
   * persisted secret. They must return NOT_CONFIGURED rather than pretending.
   */
  sendResetCode(input: { phoneE164: string; code: string; expiresInMinutes: number }): Promise<{
    status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'DRY_RUN' | 'DISABLED';
    detail?: string;
  }>;
}

export type RequestSmsPasswordResetResult = {
  acknowledged: true;
  message: string;
  /** For logs and audit ONLY. Never serialised to an anonymous caller. */
  internal: {
    userFound: boolean;
    throttled: boolean;
    delivery: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'DRY_RUN' | 'DISABLED' | 'NOT_ATTEMPTED';
    deliveryDetail?: string;
  };
};

export class RequestSmsPasswordResetUseCase {
  constructor(
    private readonly users: Pick<IUserRepository, 'findByPhone'>,
    private readonly identity: Pick<ILoyaltyIdentityRepository, 'createOtp' | 'lastOtpIssuedAt' | 'otpCountSince'>,
    private readonly delivery: ResetCodeDeliveryPort,
    private readonly hash: (v: string) => string,
    private readonly random: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: { phone: string; ip?: string | null }): Promise<RequestSmsPasswordResetResult> {
    const generic = (internal: RequestSmsPasswordResetResult['internal']): RequestSmsPasswordResetResult => ({
      acknowledged: true,
      message: GENERIC_SMS_RESET_ACKNOWLEDGEMENT,
      internal,
    });

    const phone = normalizeUgandanPhone(input.phone);
    if (!phone) return generic({ userFound: false, throttled: false, delivery: 'NOT_ATTEMPTED' });

    const user = await this.users.findByPhone(phone.e164);
    if (!user || !user.isActive) {
      // Same answer, same shape. A disabled account is not advertised either.
      return generic({ userFound: false, throttled: false, delivery: 'NOT_ATTEMPTED' });
    }

    // Bounded BEFORE the code is generated and stored, exactly as verification
    // is: a refused request must not invalidate the code the customer already
    // has.
    const at = this.now();
    const lastIssuedAt = await this.identity.lastOtpIssuedAt(user.id);
    if (lastIssuedAt && at.getTime() - lastIssuedAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      return generic({ userFound: true, throttled: true, delivery: 'NOT_ATTEMPTED' });
    }
    const issuedThisHour = await this.identity.otpCountSince(user.id, new Date(at.getTime() - 3_600_000));
    if (issuedThisHour >= OTP_MAX_PER_HOUR) {
      return generic({ userFound: true, throttled: true, delivery: 'NOT_ATTEMPTED' });
    }

    const code = this.random();
    await this.identity.createOtp({
      userId: user.id,
      phoneE164: phone.e164,
      codeHash: resetCodeHash(this.hash, code),
      expiresAt: new Date(at.getTime() + SMS_RESET_CODE_TTL_MINUTES * 60_000),
    });

    const sent = await this.delivery.sendResetCode({
      phoneE164: phone.e164,
      code,
      expiresInMinutes: SMS_RESET_CODE_TTL_MINUTES,
    });
    return generic({ userFound: true, throttled: false, delivery: sent.status, deliveryDetail: sent.detail });
  }
}

export type ResetPasswordWithSmsCodeResult =
  | { ok: true; userId: string }
  | { ok: false; code: 'WEAK_PASSWORD' | 'CODE_INVALID' | 'TOO_MANY_ATTEMPTS'; message: string };

export class ResetPasswordWithSmsCodeUseCase {
  constructor(
    private readonly users: Pick<IUserRepository, 'findByPhone'>,
    private readonly identity: Pick<ILoyaltyIdentityRepository, 'latestOtp' | 'bumpOtpAttempts' | 'consumeOtp' | 'markPhoneVerified'>,
    private readonly recovery: Pick<IAccountRecoveryRepository, 'setPasswordAndRevokeSessions'>,
    private readonly hasher: IPasswordHasher,
    private readonly hash: (v: string) => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: { phone: string; code: string; newPassword: string }): Promise<ResetPasswordWithSmsCodeResult> {
    const password = input.newPassword ?? '';
    // Checked first, before any lookup, so a weak password never burns one of
    // the five guesses.
    if (password.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, code: 'WEAK_PASSWORD', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
    }

    const invalid = (): ResetPasswordWithSmsCodeResult => ({ ok: false, code: 'CODE_INVALID', message: CODE_INVALID_MESSAGE });

    const code = (input.code ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) return invalid();

    const phone = normalizeUgandanPhone(input.phone);
    if (!phone) return invalid();

    // Unknown phone, no code outstanding, a code for a different number, a
    // consumed code and an expired code all get ONE answer. The differences
    // between them are exactly what an attacker would like to learn.
    const user = await this.users.findByPhone(phone.e164);
    if (!user || !user.isActive) return invalid();

    const otp = await this.identity.latestOtp(user.id);
    if (!otp || otp.consumedAt || otp.phoneE164 !== phone.e164) return invalid();
    if (otp.expiresAt.getTime() <= this.now().getTime()) return invalid();

    const attempts = await this.identity.bumpOtpAttempts(otp.id);
    if (attempts > SMS_RESET_MAX_ATTEMPTS) {
      return { ok: false, code: 'TOO_MANY_ATTEMPTS', message: TOO_MANY_ATTEMPTS_MESSAGE };
    }
    if (!constantTimeEquals(resetCodeHash(this.hash, code), otp.codeHash)) return invalid();

    await this.identity.consumeOtp(otp.id);
    const newHash = await this.hasher.hash(password);
    const changed = await this.recovery.setPasswordAndRevokeSessions({ userId: user.id, newPasswordHash: newHash });
    if (!changed) return invalid();

    // The customer has just proved control of this phone.
    await this.identity.markPhoneVerified(user.id, phone.e164);
    return { ok: true, userId: user.id };
  }
}
