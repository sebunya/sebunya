import { PersistedUser } from './IUserRepository';

export type RoleAssignmentOutcome = 'OK' | 'ALREADY_ASSIGNED' | 'NOT_ASSIGNED' | 'ROLE_NOT_FOUND' | 'USER_NOT_FOUND';

export interface IUserAdminRepository {
  setActive(userId: string, isActive: boolean): Promise<PersistedUser | null>;
  assignRole(userId: string, roleId: string): Promise<RoleAssignmentOutcome>;
  removeRole(userId: string, roleId: string): Promise<RoleAssignmentOutcome>;
}

export interface IUserCredentialsRepository {
  updatePasswordHash(userId: string, passwordHash: string): Promise<boolean>;
}
