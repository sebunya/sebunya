import { randomBytes } from 'node:crypto';
import { IUserRepository } from '../../ports/IUserRepository';
import { IUserIdentityRepository, ISocialIdentityProvider } from '../../ports/IUserIdentityRepository';
import { IPasswordHasher } from '../../ports/IPasswordHasher';
import { ITokenSigner } from '../../ports/ITokenSigner';
import { IOutboxWriter } from '../../ports/IOutboxWriter';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days, same as login

export type SocialLoginResult =
  | {
      ok: true;
      token: string;
      user: { id: string; email: string; phone: string | null };
      expiresAt: Date;
      outcome: 'SIGNED_IN' | 'LINKED' | 'REGISTERED';
    }
  | {
      ok: false;
      code: 'NOT_CONFIGURED' | 'EXCHANGE_FAILED' | 'EMAIL_UNVERIFIED' | 'ACCOUNT_DISABLED' | 'AUTH_NOT_CONFIGURED';
      message: string;
    };

/**
 * OAuth login. Resolution order:
 *  1. Known (provider, providerUserId) identity  -> sign in that user.
 *  2. Existing account with the same verified email -> link identity, sign in.
 *  3. Otherwise -> create an account (random unusable password), link, sign in.
 *
 * Only provider-verified emails are trusted for matching (step 2) —
 * an unverified email must never take over an existing account.
 */
export class SocialLoginUseCase {
  constructor(
    private readonly provider: ISocialIdentityProvider,
    private readonly users: IUserRepository,
    private readonly identities: IUserIdentityRepository,
    private readonly hasher: IPasswordHasher,
    private readonly signer: ITokenSigner,
    private readonly outbox: IOutboxWriter
  ) {}

  async execute(input: { code: string }): Promise<SocialLoginResult> {
    if (!this.signer.isConfigured()) {
      return { ok: false, code: 'AUTH_NOT_CONFIGURED', message: 'JWT_SECRET is missing; sign-in is disabled.' };
    }

    const exchange = await this.provider.fetchProfile(input.code);
    if (!exchange.ok) {
      return { ok: false, code: exchange.code, message: exchange.message };
    }
    const profile = exchange.profile;
    if (!profile.emailVerified) {
      return {
        ok: false,
        code: 'EMAIL_UNVERIFIED',
        message: `Your ${this.provider.provider} email is not verified. Verify it with the provider and retry.`,
      };
    }

    const email = profile.email.trim().toLowerCase();

    // 1. Known identity
    const identity = await this.identities.findByProvider(this.provider.provider, profile.providerUserId);
    if (identity) {
      const user = await this.users.findById(identity.userId);
      if (!user) return { ok: false, code: 'EXCHANGE_FAILED', message: 'Linked account no longer exists.' };
      if (!user.isActive) return { ok: false, code: 'ACCOUNT_DISABLED', message: 'This account has been disabled.' };
      return this.issue(user, 'SIGNED_IN');
    }

    // 2. Same verified email
    const existingUser = await this.users.findByEmail(email);
    if (existingUser) {
      if (!existingUser.isActive) {
        return { ok: false, code: 'ACCOUNT_DISABLED', message: 'This account has been disabled.' };
      }
      await this.identities.link({
        userId: existingUser.id,
        provider: this.provider.provider,
        providerUserId: profile.providerUserId,
        email,
      });
      return this.issue(existingUser, 'LINKED');
    }

    // 3. New account. The password is random and never disclosed — the
    // user signs in socially, or uses password reset once that ships.
    const unusablePassword = randomBytes(32).toString('hex');
    const passwordHash = await this.hasher.hash(unusablePassword);
    const created = await this.users.create({ email, phone: null, passwordHash });
    await this.identities.link({
      userId: created.id,
      provider: this.provider.provider,
      providerUserId: profile.providerUserId,
      email,
    });
    await this.outbox.append('USER_REGISTERED', {
      relatedEntity: 'user',
      relatedEntityId: created.id,
      email: created.email,
      via: this.provider.provider,
    });
    return this.issue(created, 'REGISTERED');
  }

  private async issue(
    user: { id: string; email: string; phone: string | null },
    outcome: 'SIGNED_IN' | 'LINKED' | 'REGISTERED'
  ): Promise<SocialLoginResult> {
    const token = await this.signer.sign({ subject: user.id, email: user.email, ttlSeconds: SESSION_TTL_SECONDS });
    return {
      ok: true,
      token,
      user: { id: user.id, email: user.email, phone: user.phone },
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      outcome,
    };
  }
}
