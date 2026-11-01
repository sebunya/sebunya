import type { IUserRepository } from '../../ports/IUserRepository';
import type { ISocialIdentityRepository } from '../../ports/ISocialIdentityRepository';
import type { SocialProvider } from '../../../domain/identity/SocialProvider';

/**
 * Connect a VERIFIED provider identity to the account that is signed in (Account → Sign-in methods).
 *
 * This is the deliberate path the sign-in refusals point to: a Facebook identity whose email matches an existing
 * account (never auto-linked), or a provider that shared no email. The customer has already proved the account
 * (a live session) and the provider identity (code exchange + ID token), so no email has to match.
 *
 * What it refuses, before anything is written:
 *  - an identity already connected to ANOTHER account. The repository's insert keeps the existing owner on a
 *    conflict, so without this check the call would "succeed" and connect nothing; moving it silently would let
 *    whoever holds one session take a sign-in away from another account.
 *  - a second identity from the same provider on this account, so "Remove Google" always means one thing.
 */

export type LinkSocialIdentityResult =
  | { ok: true; alreadyLinked: boolean }
  | {
      ok: false;
      code: 'ACCOUNT_DISABLED' | 'IDENTITY_IN_USE' | 'PROVIDER_ALREADY_LINKED';
      message: string;
    };

export class LinkSocialIdentityUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly identities: ISocialIdentityRepository,
  ) {}

  async execute(input: {
    userId: string;
    provider: SocialProvider;
    subject: string;
    email: string | null;
    emailVerified: boolean;
    providerName: string;
  }): Promise<LinkSocialIdentityResult> {
    const user = await this.users.findById(input.userId);
    if (!user || !user.isActive) {
      return { ok: false, code: 'ACCOUNT_DISABLED', message: 'This account is not available.' };
    }

    const owner = await this.identities.findByProviderSubject(input.provider, input.subject);
    if (owner) {
      if (owner.userId === input.userId) return { ok: true, alreadyLinked: true };
      return {
        ok: false,
        code: 'IDENTITY_IN_USE',
        message: `That ${input.providerName} account already signs in to a different GoldPlus account. Sign in with it to use that account, or remove it there first.`,
      };
    }

    const mine = await this.identities.listForUser(input.userId);
    if (mine.some((identity) => identity.provider === input.provider)) {
      return {
        ok: false,
        code: 'PROVIDER_ALREADY_LINKED',
        message: `A different ${input.providerName} account is already connected. Remove it first, then connect this one.`,
      };
    }

    await this.identities.link({
      userId: input.userId,
      provider: input.provider,
      subject: input.subject,
      email: input.email?.trim().toLowerCase() || null,
      emailVerified: input.emailVerified,
    });
    return { ok: true, alreadyLinked: false };
  }
}
