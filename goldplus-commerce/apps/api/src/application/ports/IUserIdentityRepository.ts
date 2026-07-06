export interface PersistedUserIdentity {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  email: string | null;
  createdAt: Date;
}

export interface IUserIdentityRepository {
  findByProvider(provider: string, providerUserId: string): Promise<PersistedUserIdentity | null>;
  link(input: {
    userId: string;
    provider: string;
    providerUserId: string;
    email: string | null;
  }): Promise<PersistedUserIdentity>;
  listForUser(userId: string): Promise<PersistedUserIdentity[]>;
  unlink(userId: string, provider: string): Promise<boolean>;
}

/** Result of exchanging an OAuth authorization code with a provider. */
export type SocialProfileResult =
  | { ok: true; profile: { providerUserId: string; email: string; emailVerified: boolean; name: string | null } }
  | { ok: false; code: 'NOT_CONFIGURED' | 'EXCHANGE_FAILED'; message: string };

export interface ISocialIdentityProvider {
  readonly provider: string;
  isConfigured(): boolean;
  /** Full provider authorization URL for the browser redirect. */
  getAuthorizationUrl(state: string): string | null;
  /** Exchanges the callback code for a verified profile. */
  fetchProfile(code: string): Promise<SocialProfileResult>;
}
