export interface AdminRoleReadModel {
  id: string;
  name: string;
  permissionCodes: string[];
  userCount: number;
}

export interface IAdminRoleReadRepository {
  findAll(): Promise<AdminRoleReadModel[]>;
}
