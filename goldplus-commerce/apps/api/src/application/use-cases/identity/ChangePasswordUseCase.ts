import { IUserRepository } from '../../ports/IUserRepository';
import { IPasswordHasher } from '../../ports/IPasswordHasher';
import { ILoginAttemptStore } from '../../ports/ILoginAttemptStore';
import { IPasswordChangeRepository } from '../../ports/IPasswordChangeRepository';
import { evaluateLoginLock } from '../../../domain/identity/LoginThrottle';

/**
 * A signed-in customer changes their own password.
 *
 * Until now the only way to change a password was to claim to have forgotten
 * it. Rules:
 *
 *  - The CURRENT password is required. A session alone is not proof: a phone
 *    left unlocked on a counter must not be enough to take the account.
 *  - Wrong current passwords are counted per account (the sign-in policy:
 *    5 in 15 minutes locks for 15), so a stolen session cannot be used to
 *    guess the password at leisure.
 *  - An account with no password (social sign-in only) cannot set one here;
 *    it has nothing to prove with. The reset link, which proves control of
 *    the email address, is the way to add one.
 *  - Success signs the account out everywhere, this device included, and voids
 *    any outstanding reset link. If the reason for the change is that somebody
 *    else knows the old password, their session must not survive it.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export type ChangePasswordResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      code: 'BAD_INPUT' | 'WEAK_PASSWORD' | 'SAME_PASSWORD' | 'WRONG_PASSWORD' | 'NO_PASSWORD_SET' | 'LOCKED' | 'ACCOUNT_UNAVAILABLE';
      message: string;
      retryAfterSeconds?: number;
    };

export const passwordChangeThrottleKey = (userId: string): string => `password-change|${userId}`;

export class ChangePasswordUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
    private readonly passwords: IPasswordChangeRepository,
    private readonly attempts: ILoginAttemptStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: { userId: string; currentPassword: unknown; newPassword: unknown }): Promise<ChangePasswordResult> {
    const current = typeof input.currentPassword === 'string' ? input.currentPassword : '';
    const next = typeof input.newPassword === 'string' ? input.newPassword : '';
    if (!input.userId || !current || !next) {
      return { ok: false, code: 'BAD_INPUT', message: 'Enter your current password and a new one.' };
    }
    if (next.length < MIN_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH) {
      return { ok: false, code: 'WEAK_PASSWORD', message: `The new password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.` };
    }

    const key = passwordChangeThrottleKey(input.userId);
    const lock = evaluateLoginLock(await this.attempts.getFailures(key), this.now());
    if (lock.locked) {
      return { ok: false, code: 'LOCKED', message: 'Too many wrong attempts. Please try again later.', retryAfterSeconds: lock.retryAfterSeconds };
    }

    const user = await this.users.findById(input.userId);
    if (!user || !user.isActive) {
      return { ok: false, code: 'ACCOUNT_UNAVAILABLE', message: 'This account is not available.' };
    }
    if (!user.passwordHash) {
      return {
        ok: false,
        code: 'NO_PASSWORD_SET',
        message: 'This account signs in without a password. To add one, use "Forgot your password?" on the sign-in page.',
      };
    }

    if (!(await this.hasher.verify(current, user.passwordHash))) {
      await this.attempts.addFailure(key, this.now());
      return { ok: false, code: 'WRONG_PASSWORD', message: 'Your current password is not correct.' };
    }
    if (await this.hasher.verify(next, user.passwordHash)) {
      return { ok: false, code: 'SAME_PASSWORD', message: 'The new password must be different from the current one.' };
    }

    await this.passwords.setPasswordAndRevoke(user.id, await this.hasher.hash(next));
    await this.attempts.clear(key);
    return { ok: true, userId: user.id };
  }
}
