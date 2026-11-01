import { IAdminUserReadRepository, AdminUserReadModel } from '../../ports/IAdminUserReadRepository';

export interface AdminUserDto {
  id: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  roleNames: string[];
  createdAt: string;
}

export interface AccountLookupDto extends AdminUserDto {
  /** 'STAFF' holds a role (or a pending grant); 'SHOPPER' is a customer account. */
  kind: 'STAFF' | 'SHOPPER';
  orderCount: number;
  hasPendingGrant: boolean;
}

const dto = (r: AdminUserReadModel): AdminUserDto => ({
  id: r.id, email: r.email, phone: r.phone, isActive: r.isActive, roleNames: r.roleNames, createdAt: r.createdAt.toISOString(),
});

/**
 * The staff list (2026-10-17). Shoppers are counted, never listed: the page that grants back-office roles must not
 * offer them beside every customer who ever signed up.
 */
export class ListAdminUsersUseCase {
  constructor(private readonly repo: IAdminUserReadRepository) {}

  async execute(): Promise<AdminUserDto[]> {
    return (await this.repo.findStaff()).map(dto);
  }

  async shopperAccountCount(): Promise<number> {
    return this.repo.countShopperAccounts();
  }

  /** One account by exact email, staff or shopper, for a deliberate first grant of back-office access. */
  async lookup(email: string): Promise<AccountLookupDto | null> {
    return this.toLookup(await this.repo.findAccountByEmail(email));
  }

  /** One account by id: the customer page's sign-in panel (deactivate a customer without listing customers as staff). */
  async accountById(id: string): Promise<AccountLookupDto | null> {
    return this.toLookup(await this.repo.findAccountById(id));
  }

  private toLookup(r: Awaited<ReturnType<IAdminUserReadRepository['findAccountByEmail']>>): AccountLookupDto | null {
    if (!r) return null;
    return { ...dto(r), kind: r.roleNames.length > 0 || r.hasPendingGrant ? 'STAFF' : 'SHOPPER', orderCount: r.orderCount, hasPendingGrant: r.hasPendingGrant };
  }
}
