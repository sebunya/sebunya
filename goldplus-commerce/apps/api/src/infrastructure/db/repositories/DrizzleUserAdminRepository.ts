import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { users, roles, userRoles } from '../schema/identity';
import {
  IUserAdminRepository,
  IUserCredentialsRepository,
  RoleAssignmentOutcome,
} from '../../../application/ports/IUserAdminRepository';
import { PersistedUser } from '../../../application/ports/IUserRepository';

function rowToUser(row: typeof users.$inferSelect): PersistedUser {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone ?? null,
    passwordHash: row.passwordHash,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

export class DrizzleUserAdminRepository implements IUserAdminRepository, IUserCredentialsRepository {
  async setActive(userId: string, isActive: boolean): Promise<PersistedUser | null> {
    const [row] = await db.update(users).set({ isActive }).where(eq(users.id, userId)).returning();
    return row ? rowToUser(row) : null;
  }

  async assignRole(userId: string, roleId: string): Promise<RoleAssignmentOutcome> {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return 'USER_NOT_FOUND';
    const role = await db.query.roles.findFirst({ where: eq(roles.id, roleId) });
    if (!role) return 'ROLE_NOT_FOUND';

    const existing = await db.query.userRoles.findFirst({
      where: and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)),
    });
    if (existing) return 'ALREADY_ASSIGNED';

    await db.insert(userRoles).values({ userId, roleId });
    return 'OK';
  }

  async removeRole(userId: string, roleId: string): Promise<RoleAssignmentOutcome> {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return 'USER_NOT_FOUND';
    const role = await db.query.roles.findFirst({ where: eq(roles.id, roleId) });
    if (!role) return 'ROLE_NOT_FOUND';

    const deleted = await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .returning({ userId: userRoles.userId });
    return deleted.length > 0 ? 'OK' : 'NOT_ASSIGNED';
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<boolean> {
    const updated = await db.update(users).set({ passwordHash }).where(eq(users.id, userId)).returning({ id: users.id });
    return updated.length > 0;
  }
}
