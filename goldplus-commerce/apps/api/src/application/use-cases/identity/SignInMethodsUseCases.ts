import type { IUserRepository } from '../../ports/IUserRepository';
import type { ISocialIdentityRepository } from '../../ports/ISocialIdentityRepository';
import { SOCIAL_PROVIDERS, type SocialProvider } from '../../../domain/identity/SocialProvider';

/**
 * Account → Sign-in methods: what can open this account, and removing a provider from it.
 *
 * The ways in are the password (when one is set) and each connected provider. Removing the last one would lock the
 * customer out of their own account, so the repository refuses it in the same transaction as the delete.
 */

export interface SignInMethodRow {
  provider: SocialProvider;
  displayName: string;
  /** The operator has credentials for it, so it can be used or connected now. */
  configured: boolean;
  connected: boolean;
  /** The address the provider shared when it was connected, if any. */
  email: string | null;
}

export class ListSignInMethodsUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly identities: ISocialIdentityRepository,
  ) {}

  async execute(input: {
    userId: string;
    providers: ReadonlyArray<{ provider: SocialProvider; displayName: string; configured: boolean }>;
  }): Promise<{ hasPassword: boolean; methods: SignInMethodRow[] }> {
    const [user, linked] = await Promise.all([this.users.findById(input.userId), this.identities.listForUser(input.userId)]);
    const methods = SOCIAL_PROVIDERS.map((provider) => {
      const meta = input.providers.find((p) => p.provider === provider);
      const identity = linked.find((i) => i.provider === provider) ?? null;
      return {
        provider,
        displayName: meta?.displayName ?? provider,
        configured: meta?.configured ?? false,
        connected: !!identity,
        email: identity?.email ?? null,
      };
    });
    return { hasPassword: !!user?.passwordHash, methods };
  }
}

export type RemoveSignInMethodResult =
  | { ok: true }
  | { ok: false; code: 'NOT_CONNECTED' | 'LAST_SIGN_IN_METHOD'; message: string };

export class RemoveSignInMethodUseCase {
  constructor(private readonly identities: ISocialIdentityRepository) {}

  async execute(input: { userId: string; provider: SocialProvider; providerName: string }): Promise<RemoveSignInMethodResult> {
    const linked = await this.identities.listForUser(input.userId);
    if (!linked.some((i) => i.provider === input.provider)) {
      return { ok: false, code: 'NOT_CONNECTED', message: `${input.providerName} is not connected to this account.` };
    }
    const removed = await this.identities.unlink(input.userId, input.provider);
    if (!removed.ok) {
      return {
        ok: false,
        code: 'LAST_SIGN_IN_METHOD',
        message: `${input.providerName} is the only way into this account. Set a password first (Forgot password sends you a link), or connect another provider, then remove it.`,
      };
    }
    return { ok: true };
  }
}
