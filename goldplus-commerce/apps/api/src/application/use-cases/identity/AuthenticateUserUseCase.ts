import { IUserRepository } from '../../ports/IUserRepository';
import { IPasswordHasher } from '../../ports/IPasswordHasher';
import { ITokenSigner } from '../../ports/ITokenSigner';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface AuthenticateUserInput {
  email: string;
  password: string;
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
      code: 'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'AUTH_NOT_CONFIGURED' | 'BAD_INPUT';
      message: string;
    };

export class AuthenticateUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
    private readonly signer: ITokenSigner,
  ) {}

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

    const user = await this.users.findByEmail(email);
    // Generic message either way — never disclose whether email is registered.
    const generic = { ok: false, code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } as const;

    if (!user) return generic;

    const passwordOk = await this.hasher.verify(password, user.passwordHash);
    if (!passwordOk) return generic;

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
