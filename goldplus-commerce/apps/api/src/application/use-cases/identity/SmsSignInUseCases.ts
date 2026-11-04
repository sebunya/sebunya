import type { FailureLockoutStore } from '../../ports/FailureLockoutStore';
import { normalizeUgandanPhone } from '@goldplus/shared';
import { IUserRepository } from '../../ports/IUserRepository';
import { ITokenSigner } from '../../ports/ITokenSigner';
import {
  ILoyaltyIdentityRepository,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_COOLDOWN_MS,
} from '../loyalty/LoyaltyIdentityUseCases';
import { constantTimeEquals } from './PasswordResetUseCases';
import { InMemoryMissedResetAttemptCounter, type MissedResetAttemptCounter } from './SmsPasswordResetUseCases';
import { SESSION_TTL_SECONDS } from './AuthenticateUserUseCase';

/**
 * Sign in with the phone and a code by SMS (Baymard A3, docs/ux/BAYMARD.md).
 *
 * The phone is the account for most GoldPlus customers and few remember a password they set once at a confirmation
 * page. This is the password reset flow's plumbing used as a sign-in: the same table, the same bounds, the same
 * refusal to enumerate, with its own domain marker so a sign-in code can never reset a password or verify a phone,
 * and neither of those can sign anyone in.
 *
 *  - NO USER ENUMERATION: the request answers identically whether or not the number has an account.
 *  - The code lives in the SMS and in a hash; delivered synchronously, never queued.
 *  - One use, ten minutes, five wrong guesses; issuing is bounded per hour, per day and per place.
 *  - A successful code marks the phone verified (control was just proved) and mints an ordinary session.
 *  - Sessions are NOT revoked: this is a sign-in, not a recovery.
 */
export const SMS_SIGN_IN_CODE_TTL_MINUTES = 10;
export const SMS_SIGN_IN_MAX_ATTEMPTS = 5;
export const SMS_SIGN_IN_MAX_PER_DAY = 10;
export const SMS_SIGN_IN_MAX_PER_PLACE_PER_DAY = 5;

export const GENERIC_SMS_SIGN_IN_ACKNOWLEDGEMENT =
  'If that number is on a GoldPlus account, we have sent it a 6 digit code by SMS. The code works once and expires in 10 minutes. No account yet? Create one in a minute.';
const CODE_INVALID_MESSAGE = 'That code is not correct or has expired. Ask for a new code and try again.';
const TOO_MANY_ATTEMPTS_MESSAGE = 'Too many wrong codes. Ask for a new code and try again.';

/** Domain separation from verification ('' prefix) and reset ('rst:') codes in the shared table. */
export const SIGN_IN_CODE_MARKER = 'sgn:';
export const signInCodeHash = (hash: (v: string) => string, code: string): string => `${SIGN_IN_CODE_MARKER}${hash(`sms-sign-in:${code}`)}`.slice(0, 64);

export interface SignInCodeDeliveryPort {
  sendSignInCode(input: { phoneE164: string; code: string; expiresInMinutes: number }): Promise<{
    status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'DRY_RUN' | 'DISABLED';
    detail?: string;
  }>;
}

export type RequestSmsSignInCodeResult = {
  acknowledged: true;
  message: string;
  /** For logs only; never serialised to the caller. */
  internal: { userFound: boolean; throttled: boolean; delivery: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'DRY_RUN' | 'DISABLED' | 'NOT_ATTEMPTED'; deliveryDetail?: string };
};

export class RequestSmsSignInCodeUseCase {
  constructor(
    private readonly users: Pick<IUserRepository, 'findByPhone'>,
    private readonly identity: Pick<ILoyaltyIdentityRepository, 'createOtp' | 'lastOtpIssuedAt' | 'otpCountSince'>,
    private readonly delivery: SignInCodeDeliveryPort,
    private readonly hash: (v: string) => string,
    private readonly random: () => string,
    private readonly now: () => Date = () => new Date(),
    private readonly perPlace?: FailureLockoutStore,
  ) {}

  async execute(input: { phone: string; ip?: string | null }): Promise<RequestSmsSignInCodeResult> {
    const generic = (internal: RequestSmsSignInCodeResult['internal']): RequestSmsSignInCodeResult => ({
      acknowledged: true, message: GENERIC_SMS_SIGN_IN_ACKNOWLEDGEMENT, internal,
    });
    const phone = normalizeUgandanPhone(input.phone);
    if (!phone) return generic({ userFound: false, throttled: false, delivery: 'NOT_ATTEMPTED' });
    const user = await this.users.findByPhone(phone.e164);
    if (!user || !user.isActive) return generic({ userFound: false, throttled: false, delivery: 'NOT_ATTEMPTED' });

    const at = this.now();
    const placeKey = input.ip && this.perPlace ? this.hash(`sms-sign-in-place|${user.id}|${input.ip}`) : null;
    if (placeKey && (await this.perPlace!.failures(placeKey, at.getTime()).catch(() => 0)) >= SMS_SIGN_IN_MAX_PER_PLACE_PER_DAY) {
      return generic({ userFound: true, throttled: true, delivery: 'NOT_ATTEMPTED' });
    }
    const lastIssuedAt = await this.identity.lastOtpIssuedAt(user.id);
    if (lastIssuedAt && at.getTime() - lastIssuedAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      return generic({ userFound: true, throttled: true, delivery: 'NOT_ATTEMPTED' });
    }
    if ((await this.identity.otpCountSince(user.id, new Date(at.getTime() - 3_600_000))) >= OTP_MAX_PER_HOUR) {
      return generic({ userFound: true, throttled: true, delivery: 'NOT_ATTEMPTED' });
    }
    if ((await this.identity.otpCountSince(user.id, new Date(at.getTime() - 86_400_000), 'signin')) >= SMS_SIGN_IN_MAX_PER_DAY) {
      return generic({ userFound: true, throttled: true, delivery: 'NOT_ATTEMPTED' });
    }

    const code = this.random();
    await this.identity.createOtp({
      userId: user.id, phoneE164: phone.e164, codeHash: signInCodeHash(this.hash, code),
      expiresAt: new Date(at.getTime() + SMS_SIGN_IN_CODE_TTL_MINUTES * 60_000),
    });
    if (placeKey) await this.perPlace!.recordFailure(placeKey, at.getTime(), 86_400_000).catch(() => undefined);
    const sent = await this.delivery.sendSignInCode({ phoneE164: phone.e164, code, expiresInMinutes: SMS_SIGN_IN_CODE_TTL_MINUTES });
    return generic({ userFound: true, throttled: false, delivery: sent.status, deliveryDetail: sent.detail });
  }
}

export type SignInWithSmsCodeResult =
  | { ok: true; token: string; expiresAt: Date; user: { id: string; email: string; phone: string | null } }
  | { ok: false; code: 'CODE_INVALID' | 'TOO_MANY_ATTEMPTS' | 'AUTH_NOT_CONFIGURED'; message: string };

export class SignInWithSmsCodeUseCase {
  constructor(
    private readonly users: Pick<IUserRepository, 'findByPhone'>,
    private readonly identity: Pick<ILoyaltyIdentityRepository, 'latestOtp' | 'bumpOtpAttempts' | 'consumeOtp' | 'markPhoneVerified'>,
    private readonly signer: ITokenSigner,
    private readonly hash: (v: string) => string,
    private readonly now: () => Date = () => new Date(),
    private readonly misses: MissedResetAttemptCounter = new InMemoryMissedResetAttemptCounter(),
  ) {}

  async execute(input: { phone: string; code: string }): Promise<SignInWithSmsCodeResult> {
    const invalid = (): SignInWithSmsCodeResult => ({ ok: false, code: 'CODE_INVALID', message: CODE_INVALID_MESSAGE });
    const code = (input.code ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) return invalid();
    const phone = normalizeUgandanPhone(input.phone);
    if (!phone) return invalid();
    if (!this.signer.isConfigured()) {
      return { ok: false, code: 'AUTH_NOT_CONFIGURED', message: 'Sign-in is not configured on this server.' };
    }

    // Unknown number, nothing outstanding, expired, consumed: one answer, counted per number so the 429 arrives on
    // the same guess whether or not an account exists.
    const noLiveCode = (): SignInWithSmsCodeResult => {
      const misses = this.misses.bump(this.hash(`sms-sign-in-miss:${phone.e164}`), this.now());
      return misses > SMS_SIGN_IN_MAX_ATTEMPTS ? { ok: false, code: 'TOO_MANY_ATTEMPTS', message: TOO_MANY_ATTEMPTS_MESSAGE } : invalid();
    };
    const user = await this.users.findByPhone(phone.e164);
    if (!user || !user.isActive) return noLiveCode();
    const otp = await this.identity.latestOtp(user.id, 'signin');
    if (!otp || otp.consumedAt || otp.phoneE164 !== phone.e164) return noLiveCode();
    if (otp.expiresAt.getTime() <= this.now().getTime()) return noLiveCode();
    const attempts = await this.identity.bumpOtpAttempts(otp.id);
    if (attempts > SMS_SIGN_IN_MAX_ATTEMPTS) return { ok: false, code: 'TOO_MANY_ATTEMPTS', message: TOO_MANY_ATTEMPTS_MESSAGE };
    if (!constantTimeEquals(signInCodeHash(this.hash, code), otp.codeHash)) return invalid();

    await this.identity.consumeOtp(otp.id);
    await this.identity.markPhoneVerified(user.id, phone.e164);
    const token = await this.signer.sign({ subject: user.id, email: user.email, ttlSeconds: SESSION_TTL_SECONDS });
    return {
      ok: true, token, expiresAt: new Date(this.now().getTime() + SESSION_TTL_SECONDS * 1000),
      user: { id: user.id, email: user.email, phone: user.phone },
    };
  }
}
