import { IAdminRoleReadRepository } from '../../ports/IAdminRoleReadRepository';

export interface AdminRoleDto {
  id: string;
  name: string;
  permissionCodes: string[];
  userCount: number;
}

export class ListAdminRolesUseCase {
  constructor(private readonly repo: IAdminRoleReadRepository) {}

  async execute(): Promise<AdminRoleDto[]> {
    const rows = await this.repo.findAll();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      permissionCodes: r.permissionCodes,
      userCount: r.userCount
    }));
  }
}
