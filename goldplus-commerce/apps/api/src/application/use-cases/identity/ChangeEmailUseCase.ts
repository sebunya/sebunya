import { IUserRepository } from '../../ports/IUserRepository';
import { IPasswordHasher } from '../../ports/IPasswordHasher';
import { ILoginAttemptStore } from '../../ports/ILoginAttemptStore';
import { evaluateLoginLock } from '../../../domain/identity/LoginThrottle';
import { passwordChangeThrottleKey } from './ChangePasswordUseCase';

/**
 * Change the account's email (Baymard A8, docs/ux/BAYMARD.md). Proved by the current password, throttled with the
 * same key as a password change so guessing one does not get a fresh budget on the other. The phone changes through
 * the verification code flow, never here: a phone is only ever set by proving control of it.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type ChangeEmailResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; code: 'BAD_INPUT' | 'SAME_EMAIL' | 'WRONG_PASSWORD' | 'NO_PASSWORD_SET' | 'EMAIL_TAKEN' | 'LOCKED' | 'ACCOUNT_UNAVAILABLE'; message: string; retryAfterSeconds?: number };

export class ChangeEmailUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
    private readonly attempts: ILoginAttemptStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: { userId: string; newEmail: unknown; currentPassword: unknown }): Promise<ChangeEmailResult> {
    const email = typeof input.newEmail === 'string' ? input.newEmail.trim().toLowerCase() : '';
    const password = typeof input.currentPassword === 'string' ? input.currentPassword : '';
    if (!input.userId || !email || !password) return { ok: false, code: 'BAD_INPUT', message: 'Enter the new email and your current password.' };
    if (!EMAIL_SHAPE.test(email) || email.length > 255) return { ok: false, code: 'BAD_INPUT', message: 'Enter a valid email address.' };

    const key = passwordChangeThrottleKey(input.userId);
    const lock = evaluateLoginLock(await this.attempts.getFailures(key), this.now());
    if (lock.locked) return { ok: false, code: 'LOCKED', message: 'Too many wrong attempts. Please try again later.', retryAfterSeconds: lock.retryAfterSeconds };

    const user = await this.users.findById(input.userId);
    if (!user || !user.isActive) return { ok: false, code: 'ACCOUNT_UNAVAILABLE', message: 'This account is not available.' };
    if (!user.passwordHash) {
      return { ok: false, code: 'NO_PASSWORD_SET', message: 'This account signs in without a password. Set one first with "Forgot your password?" on the sign-in page, then change the email.' };
    }
    if (!(await this.hasher.verify(password, user.passwordHash))) {
      await this.attempts.addFailure(key, this.now());
      return { ok: false, code: 'WRONG_PASSWORD', message: 'Your current password is not correct.' };
    }
    await this.attempts.clear(key);
    if (email === user.email.toLowerCase()) return { ok: false, code: 'SAME_EMAIL', message: 'That is already the email on this account.' };
    const holder = await this.users.findByEmail(email);
    if (holder && holder.id !== user.id) return { ok: false, code: 'EMAIL_TAKEN', message: 'That email cannot be used on this account.' };
    try {
      await this.users.updateEmail(user.id, email);
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') return { ok: false, code: 'EMAIL_TAKEN', message: 'That email cannot be used on this account.' };
      throw err;
    }
    return { ok: true, userId: user.id, email };
  }
}
