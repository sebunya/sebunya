import { IUserRepository } from '../../ports/IUserRepository';
import { IPasswordHasher } from '../../ports/IPasswordHasher';
import { ITokenSigner } from '../../ports/ITokenSigner';
import { IOutboxWriter } from '../../ports/IOutboxWriter';
import { isValidEmail, validatePassword } from '../../../domain/identity/PasswordPolicy';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days, same as login

export type RegisterUserResult =
  | {
      ok: true;
      token: string;
      user: { id: string; email: string; phone: string | null };
      expiresAt: Date;
    }
  | {
      ok: false;
      code: 'BAD_EMAIL' | 'BAD_PASSWORD' | 'BAD_PHONE' | 'EMAIL_TAKEN' | 'AUTH_NOT_CONFIGURED';
      message: string;
    };

export class RegisterUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
    private readonly signer: ITokenSigner,
    private readonly outbox: IOutboxWriter
  ) {}

  async execute(input: { email: string; password: string; phone?: string | null }): Promise<RegisterUserResult> {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) {
      return { ok: false, code: 'BAD_EMAIL', message: 'A valid email address is required.' };
    }

    const passwordCheck = validatePassword(input.password ?? '');
    if (!passwordCheck.ok) {
      return { ok: false, code: 'BAD_PASSWORD', message: passwordCheck.message };
    }

    let phone: string | null = null;
    if (input.phone) {
      phone = String(input.phone).replace(/[\s-]/g, '');
      if (!/^\+?[0-9]{9,15}$/.test(phone)) {
        return { ok: false, code: 'BAD_PHONE', message: 'Phone must be 9-15 digits (optionally starting with +).' };
      }
    }

    if (!this.signer.isConfigured()) {
      return {
        ok: false,
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Registration is not configured. JWT_SECRET environment variable is missing.',
      };
    }

    const existing = await this.users.findByEmail(email);
    if (existing) {
      return { ok: false, code: 'EMAIL_TAKEN', message: 'An account with this email already exists. Try signing in.' };
    }

    const passwordHash = await this.hasher.hash(input.password);
    const user = await this.users.create({ email, phone, passwordHash });

    // Welcome email goes through the transactional outbox so a mail
    // outage can never fail a registration.
    await this.outbox.append('USER_REGISTERED', {
      relatedEntity: 'user',
      relatedEntityId: user.id,
      email: user.email,
    });

    const token = await this.signer.sign({ subject: user.id, email: user.email, ttlSeconds: SESSION_TTL_SECONDS });

    return {
      ok: true,
      token,
      user: { id: user.id, email: user.email, phone: user.phone },
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    };
  }
}
