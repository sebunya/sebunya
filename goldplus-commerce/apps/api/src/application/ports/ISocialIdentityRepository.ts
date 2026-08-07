import type { SocialProvider } from '../../domain/identity/SocialProvider';

export interface LinkedIdentity {
  id: string;
  userId: string;
  provider: SocialProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

export interface ISocialIdentityRepository {
  /** The identity of an account at a provider — the login lookup. */
  findByProviderSubject(provider: SocialProvider, subject: string): Promise<LinkedIdentity | null>;

  /** Every provider linked to a user, for account settings. */
  listForUser(userId: string): Promise<LinkedIdentity[]>;

  link(input: {
    userId: string;
    provider: SocialProvider;
    subject: string;
    email: string | null;
    emailVerified: boolean;
  }): Promise<LinkedIdentity>;

  /**
   * Create a user who has NO password (social-only) together with their first
   * identity, in one transaction — a user row without its identity is an
   * account nobody can ever sign into.
   */
  createUserWithIdentity(input: {
    email: string;
    provider: SocialProvider;
    subject: string;
    emailVerified: boolean;
  }): Promise<{ userId: string; identity: LinkedIdentity }>;

  markLogin(identityId: string): Promise<void>;

  /**
   * Refuse to remove the last way into an account: unlinking is only allowed
   * when a password or another identity remains.
   */
  unlink(userId: string, provider: SocialProvider): Promise<{ ok: boolean; reason?: string }>;
}
