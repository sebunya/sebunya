export interface AdminUserReadModel {
  id: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  roleNames: string[];
  createdAt: Date;
}

/** One account found by its exact email, for the "give an existing account back-office access" step. */
export interface AccountLookupModel extends AdminUserReadModel {
  /** Orders placed while signed in to this account: a shopper's history, shown before anyone grants it access. */
  orderCount: number;
  /** A full-access grant for this account is waiting for a second administrator. */
  hasPendingGrant: boolean;
}

/**
 * Staff and shoppers share one users table (2026-10-17). A STAFF account is one holding at least one role, or one
 * with a pending full-access grant request; every other account is a shopper and belongs in the customer screens,
 * never on the staff list where a role is one click away.
 */
export interface IAdminUserReadRepository {
  /** Every staff account (no recency cap: an old administrator must never fall off the list). */
  findStaff(): Promise<AdminUserReadModel[]>;
  /** How many accounts are shoppers (no role, no pending grant). */
  countShopperAccounts(): Promise<number>;
  /** The account with exactly this email (case-insensitive), or null. */
  findAccountByEmail(email: string): Promise<AccountLookupModel | null>;
  /** One account by id (a customer page knows its account id, not its email). */
  findAccountById(id: string): Promise<AccountLookupModel | null>;
}
