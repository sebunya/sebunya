export interface PersistedUser {
  id: string;
  email: string;
  phone: string | null;
  /** NULL for a social-only account (0106): password login fails closed. */
  passwordHash: string | null;
  isActive: boolean;
  createdAt: Date;
  /** Slice 3B immediate hard-revocation cutoff; null means none. */
  sessionsInvalidatedAfter?: Date | null;
  /** When the customer proved control of the phone on file; null means never. */
  phoneVerifiedAt?: Date | null;
}

export interface IUserRepository {
  findByEmail(email: string): Promise<PersistedUser | null>;
  findById(id: string): Promise<PersistedUser | null>;
  /**
   * The account carrying this phone, in E.164. Registration stores whatever
   * shape the customer typed, so an implementation must match the local
   * 0-prefixed form as well. Ambiguity (more than one match) is answered with
   * null: a reset code must never go to "one of" two accounts.
   */
  findByPhone(phoneE164: string): Promise<PersistedUser | null>;
  create(input: {
    email: string;
    phone: string | null;
    passwordHash: string;
  }): Promise<PersistedUser>;
  /**
   * Kill every token issued at or before `at`.
   *
   * Revoking the refresh families is not enough on its own: the access token
   * each device already holds keeps verifying until its own TTL runs out. This
   * is the cutoff the auth middleware checks, and it is what makes
   * "sign out everywhere" true at the moment it is pressed.
   */
  invalidateSessionsAfter(userId: string, at: Date): Promise<void>;
}
