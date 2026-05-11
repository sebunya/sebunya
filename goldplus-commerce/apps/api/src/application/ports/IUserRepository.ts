export interface PersistedUser {
  id: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  isActive: boolean;
  createdAt: Date;
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
