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
}

export interface IUserRepository {
  findByEmail(email: string): Promise<PersistedUser | null>;
  findById(id: string): Promise<PersistedUser | null>;
  create(input: {
    email: string;
    phone: string | null;
    passwordHash: string;
  }): Promise<PersistedUser>;
}
