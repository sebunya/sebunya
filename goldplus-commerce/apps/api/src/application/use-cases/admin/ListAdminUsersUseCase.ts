import { IAdminUserReadRepository } from '../../ports/IAdminUserReadRepository';

export interface AdminUserDto {
  id: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  roleNames: string[];
  createdAt: string;
}

export class ListAdminUsersUseCase {
  constructor(private readonly repo: IAdminUserReadRepository) {}

  async execute(): Promise<AdminUserDto[]> {
    const rows = await this.repo.findAll();
    return rows.map(r => ({
      id: r.id,
      email: r.email,
      phone: r.phone,
      isActive: r.isActive,
      roleNames: r.roleNames,
      createdAt: r.createdAt.toISOString()
    }));
  }
}
