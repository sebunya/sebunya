import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { IUserRepository } from '../../ports/IUserRepository';
import { IPasswordHasher } from '../../ports/IPasswordHasher';
import { IAccountRecoveryRepository } from '../../ports/IAccountRecoveryRepository';

/**
 * Password reset (0106).
 *
 * A customer who forgot their password had no way back into their account.
 * This is that way, and it is deliberately unexciting: the interesting part of
 * a reset flow is everything it refuses to tell you.
 *
 * Rules encoded here:
 *
 *  - NO USER ENUMERATION. The request endpoint returns the same answer for a
 *    registered address and an unregistered one. "No account with that email"
 *    is a free list of your customers, and it is the reason credential
 *    stuffing knows where to aim.
 *  - The raw token is a 32-byte random value shown once. Only its SHA-256 is
 *    stored, so a database read cannot be replayed into a takeover.
 *  - Tokens are single-use and short-lived, and a successful reset voids every
 *    other outstanding link for that account.
 *  - A reset REVOKES EVERY SESSION. If the reason for resetting is that
 *    somebody else is in the account, a new password that leaves their session
 *    alive has fixed nothing.
 *  - Throttled per account, so this cannot be used to flood an inbox.
 *
 * Delivery is a separate concern and honestly reported: if no mail transport
 * is configured the token is still issued and the caller still gets the
 * generic answer, while the operator sees NOT_CONFIGURED. The alternative —
 * telling an anonymous caller that delivery is off — leaks configuration to
 * exactly the people who should not have it.
 */

const TOKEN_BYTES = 32;
const TOKEN_TTL_MINUTES = 60;
const MAX_REQUESTS_PER_HOUR = 3;
const MIN_PASSWORD_LENGTH = 8;

/** The generic answer. Identical for every input, by design. */
export const GENERIC_RESET_ACKNOWLEDGEMENT =
  'If that email address has an account, a password reset link is on its way. The link expires in an hour.';

export const hashResetToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export interface ResetDeliveryPort {
  /**
   * Deliver the link. Implementations MUST return NOT_CONFIGURED rather than
   * pretending — a reset that silently never arrives is worse than one that
   * says it cannot be sent.
   */
  sendPasswordReset(input: { email: string; rawToken: string; expiresAt: Date }): Promise<{
    /**
     * DISABLED is distinct from FAILED and from NOT_CONFIGURED on purpose:
     * "a governance flag is blocking customer email", "no transport is
     * configured" and "the send was attempted and broke" are three different
     * operator problems with three different fixes. Collapsing them sends
     * somebody to check the wrong thing.
     */
    status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'DRY_RUN' | 'DISABLED';
    detail?: string;
  }>;
}

export type RequestPasswordResetResult = {
  /** Always true: the caller learns nothing about whether the account exists. */
  acknowledged: true;
  message: string;
  /** For logs and audit ONLY — never serialised to an anonymous caller. */
  internal: {
    userFound: boolean;
    throttled: boolean;
    delivery: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'DRY_RUN' | 'DISABLED' | 'NOT_ATTEMPTED';
    /** The provider's own words. A status without a reason is not actionable. */
    deliveryDetail?: string;
  };
};

export class RequestPasswordResetUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly recovery: IAccountRecoveryRepository,
    private readonly delivery: ResetDeliveryPort,
  ) {}

  async execute(input: { email: string; ip?: string | null }): Promise<RequestPasswordResetResult> {
    const email = (input.email ?? '').trim().toLowerCase();
    const generic = (internal: RequestPasswordResetResult['internal']): RequestPasswordResetResult => ({
      acknowledged: true,
      message: GENERIC_RESET_ACKNOWLEDGEMENT,
      internal,
    });

    if (!email || email.length > 255 || !email.includes('@')) {
      return generic({ userFound: false, throttled: false, delivery: 'NOT_ATTEMPTED' });
    }

    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) {
      // Same answer, same shape. A disabled account is not advertised either.
      return generic({ userFound: false, throttled: false, delivery: 'NOT_ATTEMPTED' });
    }

    const since = new Date(Date.now() - 60 * 60 * 1000);
    if ((await this.recovery.countRecentTokens(user.id, since)) >= MAX_REQUESTS_PER_HOUR) {
      // Still the generic answer: a different response for a throttled account
      // would confirm the account exists.
      return generic({ userFound: true, throttled: true, delivery: 'NOT_ATTEMPTED' });
    }

    const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);
    await this.recovery.issueToken({
      userId: user.id,
      tokenHash: hashResetToken(rawToken),
      expiresAt,
      requestedIp: input.ip ?? null,
    });

    const sent = await this.delivery.sendPasswordReset({ email: user.email, rawToken, expiresAt });
    return generic({ userFound: true, throttled: false, delivery: sent.status, deliveryDetail: sent.detail });
  }
}

export type ResetPasswordResult =
  | { ok: true; userId: string }
  | { ok: false; code: 'INVALID_TOKEN' | 'EXPIRED' | 'ALREADY_USED' | 'WEAK_PASSWORD'; message: string };

export class ResetPasswordUseCase {
  constructor(
    private readonly recovery: IAccountRecoveryRepository,
    private readonly hasher: IPasswordHasher,
  ) {}

  async execute(input: { token: string; newPassword: string }): Promise<ResetPasswordResult> {
    const raw = (input.token ?? '').trim();
    const password = input.newPassword ?? '';

    if (password.length < MIN_PASSWORD_LENGTH) {
      return {
        ok: false,
        code: 'WEAK_PASSWORD',
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      };
    }
    if (!raw) {
      return { ok: false, code: 'INVALID_TOKEN', message: 'This reset link is not valid. Request a new one.' };
    }

    const record = await this.recovery.findByTokenHash(hashResetToken(raw));
    if (!record) {
      return { ok: false, code: 'INVALID_TOKEN', message: 'This reset link is not valid. Request a new one.' };
    }
    if (record.consumedAt) {
      return { ok: false, code: 'ALREADY_USED', message: 'This reset link has already been used. Request a new one.' };
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      return { ok: false, code: 'EXPIRED', message: 'This reset link has expired. Request a new one.' };
    }

    const newHash = await this.hasher.hash(password);
    const consumed = await this.recovery.consumeAndSetPassword({
      tokenId: record.id,
      userId: record.userId,
      newPasswordHash: newHash,
    });

    // Lost the race against a simultaneous click on the same link.
    if (!consumed) {
      return { ok: false, code: 'ALREADY_USED', message: 'This reset link has already been used. Request a new one.' };
    }

    return { ok: true, userId: record.userId };
  }
}

/** Constant-time compare, exported for tests that assert no early exit. */
export const constantTimeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};
