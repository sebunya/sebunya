import { db } from '../client';
import { roles, rolePermissions, permissions, userRoles } from '../schema/identity';
import { IAdminRoleReadRepository, AdminRoleReadModel } from '../../../application/ports/IAdminRoleReadRepository';

export class DrizzleAdminRoleReadRepository implements IAdminRoleReadRepository {
  async findAll(): Promise<AdminRoleReadModel[]> {
    const [roleRows, rolePermRows, permissionRows, userRoleRows] = await Promise.all([
      db.query.roles.findMany(),
      db.query.rolePermissions.findMany(),
      db.query.permissions.findMany(),
      db.query.userRoles.findMany(),
    ]);

    const permissionById = new Map(permissionRows.map((p) => [p.id, `${p.action}.${p.resource}`]));

    const permsByRole = new Map<string, string[]>();
    for (const row of rolePermRows) {
      const code = permissionById.get(row.permissionId);
      if (!code) continue;
      const list = permsByRole.get(row.roleId) ?? [];
      list.push(code);
      permsByRole.set(row.roleId, list);
    }

    const userCountByRole = new Map<string, number>();
    for (const row of userRoleRows) {
      userCountByRole.set(row.roleId, (userCountByRole.get(row.roleId) ?? 0) + 1);
    }

    return roleRows.map((r) => ({
      id: r.id,
      name: r.name,
      permissionCodes: (permsByRole.get(r.id) ?? []).sort(),
      userCount: userCountByRole.get(r.id) ?? 0,
    }));
  }
}
