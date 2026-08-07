import type { IUserRepository } from '../../ports/IUserRepository';
import type { ISocialIdentityRepository } from '../../ports/ISocialIdentityRepository';
import type { SocialProvider } from '../../../domain/identity/SocialProvider';

/**
 * Turn a VERIFIED provider identity into a GoldPlus account (0106).
 *
 * Everything upstream of this has already proved the identity cryptographically
 * (signature, issuer, audience, nonce). This decides the only remaining
 * question, which is the dangerous one: WHICH account does it belong to?
 *
 * Three outcomes, in order:
 *
 *  1. The (provider, subject) is already linked → sign that user in. This is
 *     the common path and the reason `subject` is the key rather than the
 *     email: people change their email address, and an account should survive
 *     that.
 *
 *  2. Nobody is linked, and no local account has that email → create a new,
 *     password-less account.
 *
 *  3. Nobody is linked, but a local account HAS that email → this is the
 *     account-takeover decision, and it is refused unless BOTH hold:
 *       - the provider asserts the email is verified, and
 *       - the provider is one we trust to verify it (Google, Apple).
 *     Otherwise the customer is asked to sign in normally and link
 *     deliberately. Silently merging an unverified provider email into an
 *     existing account hands that account to whoever claimed the address.
 */

export interface SocialIdentityInput {
  provider: SocialProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** From the provider registry — whether auto-link is permitted at all. */
  autoLinkOnVerifiedEmail: boolean;
}

export type ResolveSocialIdentityResult =
  | { ok: true; userId: string; created: boolean; linked: boolean }
  | {
      ok: false;
      code: 'NO_EMAIL_FROM_PROVIDER' | 'MANUAL_LINK_REQUIRED' | 'ACCOUNT_DISABLED';
      message: string;
    };

export class ResolveSocialIdentityUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly identities: ISocialIdentityRepository,
  ) {}

  async execute(input: SocialIdentityInput): Promise<ResolveSocialIdentityResult> {
    // 1. Already linked — the ordinary sign-in.
    const existing = await this.identities.findByProviderSubject(input.provider, input.subject);
    if (existing) {
      const user = await this.users.findById(existing.userId);
      if (user && !user.isActive) {
        return { ok: false, code: 'ACCOUNT_DISABLED', message: 'This account has been disabled.' };
      }
      await this.identities.markLogin(existing.id);
      return { ok: true, userId: existing.userId, created: false, linked: false };
    }

    const email = input.email?.trim().toLowerCase() || null;
    if (!email) {
      // Apple lets a user withhold their address on re-authorisation, and it
      // is only ever sent on the FIRST authorisation. With no email and no
      // prior link there is nothing to attach this person to.
      return {
        ok: false,
        code: 'NO_EMAIL_FROM_PROVIDER',
        message:
          'Your provider did not share an email address, so we cannot match or create an account. Sign in with your email and password, then link the provider from your account settings.',
      };
    }

    const byEmail = await this.users.findByEmail(email);

    // 2. Nobody has this email — a genuinely new customer.
    if (!byEmail) {
      const created = await this.identities.createUserWithIdentity({
        email,
        provider: input.provider,
        subject: input.subject,
        emailVerified: input.emailVerified,
      });
      return { ok: true, userId: created.userId, created: true, linked: true };
    }

    if (!byEmail.isActive) {
      return { ok: false, code: 'ACCOUNT_DISABLED', message: 'This account has been disabled.' };
    }

    // 3. The takeover decision.
    if (!input.autoLinkOnVerifiedEmail || !input.emailVerified) {
      return {
        ok: false,
        code: 'MANUAL_LINK_REQUIRED',
        message:
          'An account already uses this email address. Sign in with your password first, then link this provider from your account settings — we will not attach it automatically.',
      };
    }

    await this.identities.link({
      userId: byEmail.id,
      provider: input.provider,
      subject: input.subject,
      email,
      emailVerified: input.emailVerified,
    });
    return { ok: true, userId: byEmail.id, created: false, linked: true };
  }
}
