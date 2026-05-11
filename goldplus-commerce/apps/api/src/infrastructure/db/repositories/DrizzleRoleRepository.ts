import { eq, inArray } from 'drizzle-orm';
import { db } from '../client';
import { userRoles, rolePermissions, permissions } from '../schema/identity';
import { IRoleRepository } from '../../../application/ports/IRoleRepository';

export class DrizzleRoleRepository implements IRoleRepository {
  async findPermissionsForUser(userId: string): Promise<string[]> {
    if (!userId) return [];

    const userRoleRows = await db.query.userRoles.findMany({ where: eq(userRoles.userId, userId) });
    if (userRoleRows.length === 0) return [];

    const roleIds = userRoleRows.map((r) => r.roleId);

    const rolePermRows = await db.query.rolePermissions.findMany({
      where: inArray(rolePermissions.roleId, roleIds),
    });
    if (rolePermRows.length === 0) return [];

    const permissionIds = Array.from(new Set(rolePermRows.map((r) => r.permissionId)));

    const permissionRows = await db.query.permissions.findMany({
      where: inArray(permissions.id, permissionIds),
    });

    const codes = permissionRows.map((p) => `${p.action}.${p.resource}`);
    return Array.from(new Set(codes)).sort();
  }
}
