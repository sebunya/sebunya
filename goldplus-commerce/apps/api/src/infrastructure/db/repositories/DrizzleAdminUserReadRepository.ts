import { desc } from 'drizzle-orm';
import { db } from '../client';
import { users, userRoles, roles } from '../schema/identity';
import { IAdminUserReadRepository, AdminUserReadModel } from '../../../application/ports/IAdminUserReadRepository';

export class DrizzleAdminUserReadRepository implements IAdminUserReadRepository {
  async findAll(): Promise<AdminUserReadModel[]> {
    const userRows = await db.query.users.findMany({
      orderBy: [desc(users.createdAt)],
      limit: 200,
    });

    if (userRows.length === 0) {
      return [];
    }

    const userRoleRows = await db.query.userRoles.findMany();
    const roleRows = await db.query.roles.findMany();
    const roleNameById = new Map(roleRows.map((r) => [r.id, r.name]));

    const rolesByUser = new Map<string, string[]>();
    for (const row of userRoleRows) {
      const name = roleNameById.get(row.roleId);
      if (!name) continue;
      const list = rolesByUser.get(row.userId) ?? [];
      list.push(name);
      rolesByUser.set(row.userId, list);
    }

    return userRows.map((u) => ({
      id: u.id,
      email: u.email,
      phone: u.phone ?? null,
      isActive: u.isActive,
      roleNames: rolesByUser.get(u.id) ?? [],
      createdAt: u.createdAt,
    }));
  }
}
