/**
 * Write side of role management (2026-09-12). The read side stays in
 * IAdminRoleReadRepository. Permission codes are the registry codes
 * (`products.read`); the repository translates them to rows.
 */
export interface AdminRoleDetail {
  id: string;
  name: string;
  permissionCodes: string[];
  userCount: number;
}

export interface IAdminRoleWriteRepository {
  findRoleByName(name: string): Promise<{ id: string; name: string } | null>;
  findRoleById(id: string): Promise<AdminRoleDetail | null>;
  /** Creates the role and grants the codes in one transaction. Codes must already exist as rows. */
  createRole(name: string, permissionCodes: string[]): Promise<{ id: string }>;
  /** Replaces the role's grants with exactly these codes, in one transaction. */
  replacePermissions(roleId: string, permissionCodes: string[]): Promise<void>;
  deleteRole(roleId: string): Promise<void>;
  /** Active users who hold `code` through ANY role other than `roleId` — the lockout guard's question. */
  countActiveUsersWithPermissionOutsideRole(code: string, roleId: string): Promise<number>;
}
