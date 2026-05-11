export interface AdminUserReadModel {
  id: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  roleNames: string[];
  createdAt: Date;
}

export interface IAdminUserReadRepository {
  findAll(): Promise<AdminUserReadModel[]>;
}
