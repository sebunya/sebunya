import { IUserRepository } from '../../ports/IUserRepository';
import { IPasswordHasher } from '../../ports/IPasswordHasher';
import { ITokenSigner } from '../../ports/ITokenSigner';
import { ILoginAttemptStore } from '../../ports/ILoginAttemptStore';
import { evaluateLoginLock, loginThrottleKey } from '../../../domain/identity/LoginThrottle';

// A real scrypt hash of an unguessable value, verified for unknown emails so
// the response time does not reveal whether an email is registered.
const TIMING_DUMMY_PASSWORD = 'timing-equalizer-not-a-real-credential';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface AuthenticateUserInput {
  email: string;
  password: string;
  /** Caller IP for account-level lockout; optional for backwards compatibility. */
  ip?: string;
}

export type AuthenticateUserResult =
  | {
      ok: true;
      token: string;
      user: { id: string; email: string; phone: string | null };
      expiresAt: Date;
    }
  | {
      ok: false;
      code: 'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'AUTH_NOT_CONFIGURED' | 'BAD_INPUT' | 'LOCKED';
      message: string;
      retryAfterSeconds?: number;
    };

export class AuthenticateUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
    private readonly signer: ITokenSigner,
    private readonly attempts: ILoginAttemptStore | null = null,
  ) {}

  private dummyHashPromise: Promise<string> | null = null;

  /** Lazily-built real hash so unknown-email requests still pay a verify. */
  private dummyHash(): Promise<string> {
    if (!this.dummyHashPromise) this.dummyHashPromise = this.hasher.hash(TIMING_DUMMY_PASSWORD);
    return this.dummyHashPromise;
  }

  async execute(input: AuthenticateUserInput): Promise<AuthenticateUserResult> {
    const email = (input.email ?? '').trim().toLowerCase();
    const password = input.password ?? '';

    if (!email || !password) {
      return { ok: false, code: 'BAD_INPUT', message: 'Email and password are required.' };
    }
    if (!this.signer.isConfigured()) {
      return {
        ok: false,
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Authentication is not configured. JWT_SECRET environment variable is missing.',
      };
    }

    // Account-level lockout (Slice 1B): 5 failures per email+ip in 15 minutes.
    const throttleKey = loginThrottleKey(email, input.ip ?? '');
    if (this.attempts) {
      const lock = evaluateLoginLock(await this.attempts.getFailures(throttleKey), new Date());
      if (lock.locked) {
        return {
          ok: false,
          code: 'LOCKED',
          message: 'Too many failed sign-in attempts. Please try again later.',
          retryAfterSeconds: lock.retryAfterSeconds,
        };
      }
    }

    const user = await this.users.findByEmail(email);
    // Generic message either way — never disclose whether email is registered.
    const generic = { ok: false, code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } as const;
    const failGeneric = async () => {
      if (this.attempts) await this.attempts.addFailure(throttleKey, new Date());
      return generic;
    };

    if (!user) {
      // Verify against a real (dummy) hash so timing does not leak registration.
      await this.hasher.verify(password, await this.dummyHash());
      return failGeneric();
    }

    const passwordOk = await this.hasher.verify(password, user.passwordHash);
    if (!passwordOk) return failGeneric();

    if (this.attempts) await this.attempts.clear(throttleKey);

    if (!user.isActive) {
      return { ok: false, code: 'ACCOUNT_DISABLED', message: 'This account has been disabled.' };
    }

    const token = await this.signer.sign({
      subject: user.id,
      email: user.email,
      ttlSeconds: SESSION_TTL_SECONDS,
    });

    return {
      ok: true,
      token,
      user: { id: user.id, email: user.email, phone: user.phone },
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    };
  }
}
